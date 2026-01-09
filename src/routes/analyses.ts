import { Router } from 'express';
import { CreateAnalysisSchema } from '../lib/shared';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { addAnalysisJob } from '../jobs/analysisQueue';
import { broadcastAnalysisCreated } from '../lib/websocket';

const router = Router();

// Analysis limits by subscription tier
// -1 means unlimited
const ANALYSIS_LIMITS: Record<string, number> = {
  free: 2,      // 2 per week
  premium: 1,   // 1 per week
  pro: -1,      // Unlimited
  elite: -1,    // Unlimited
};

// Create new analysis
router.post('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const data = CreateAnalysisSchema.parse(req.body);
    const userId = req.user!.userId;

    // Get user with subscription to determine tier
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    // Determine subscription tier
    const isSubscriptionActive = user?.subscription?.status === 'active'
      && user?.subscription?.currentPeriodEnd
      && new Date(user.subscription.currentPeriodEnd) > new Date();

    const tier = isSubscriptionActive ? (user?.subscription?.tier || 'free') : 'free';

    // Admin override
    const isAdmin = user?.role === 'admin' || user?.role === 'nathan';
    const limit = isAdmin ? 1000 : (ANALYSIS_LIMITS[tier] ?? ANALYSIS_LIMITS.free);

    // Skip rate limiting for unlimited tiers
    if (limit > 0) {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const recentCount = await prisma.analysis.count({
        where: {
          userId,
          createdAt: { gte: oneWeekAgo },
        },
      });

      if (recentCount >= limit) {
        const tierNames: Record<string, string> = {
          free: 'Free',
          premium: 'Premium',
        };
        const upgradeMessage = tier === 'premium'
          ? 'Upgrade to Pro for unlimited analyses.'
          : 'Upgrade for more video analyses.';

        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: `${tierNames[tier] || 'Your'} plan allows ${limit} video${limit > 1 ? 's' : ''} per week. ${upgradeMessage}`,
          limit,
          used: recentCount,
          tier,
        });
      }
    }

    // Create video asset
    const videoAsset = await prisma.videoAsset.create({
      data: {
        key: data.videoKey,
        url: data.videoUrl || `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${data.videoKey}`,
        filename: data.videoKey.split('/').pop() || 'video',
        sizeBytes: 0, // Will be updated by worker
      },
    });

    // Create analysis
    const analysis = await prisma.analysis.create({
      data: {
        userId,
        videoAssetId: videoAsset.id,
        pitchType: data.pitchType,
        handedness: data.handedness,
        goal: data.goal,
        status: 'queued',
      },
      include: {
        videoAsset: true,
      },
    });

    // Queue analysis job
    await addAnalysisJob(analysis.id);

    // Broadcast real-time event
    broadcastAnalysisCreated(userId, analysis);

    res.status(201).json({
      id: analysis.id,
      userId: analysis.userId,
      videoKey: videoAsset.key,
      videoUrl: videoAsset.url,
      pitchType: analysis.pitchType,
      handedness: analysis.handedness,
      goal: analysis.goal,
      status: analysis.status,
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});

// List analyses for current user
router.get('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const skip = (page - 1) * pageSize;

    const [analyses, total] = await Promise.all([
      prisma.analysis.findMany({
        where: { userId },
        include: {
          videoAsset: true,
          metrics: true,
          report: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.analysis.count({ where: { userId } }),
    ]);

    const items = analyses.map((a) => ({
      id: a.id,
      userId: a.userId,
      videoKey: a.videoAsset.key,
      videoUrl: a.videoAsset.url,
      thumbnailUrl: a.videoAsset.thumbnailUrl,
      pitchType: a.pitchType,
      handedness: a.handedness,
      goal: a.goal,
      status: a.status,
      report: a.report ? JSON.parse(a.report.data as string) : undefined,
      errorMessage: a.errorMessage,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));

    res.json({ items, total, page, pageSize });
  } catch (error) {
    next(error);
  }
});

// Get specific analysis
router.get('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const analysis = await prisma.analysis.findFirst({
      where: { id, userId },
      include: {
        videoAsset: true,
        metrics: true,
        report: true,
      },
    });

    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    res.json({
      id: analysis.id,
      userId: analysis.userId,
      videoKey: analysis.videoAsset.key,
      videoUrl: analysis.videoAsset.url,
      thumbnailUrl: analysis.videoAsset.thumbnailUrl,
      pitchType: analysis.pitchType,
      handedness: analysis.handedness,
      goal: analysis.goal,
      status: analysis.status,
      report: analysis.report ? JSON.parse(analysis.report.data as string) : undefined,
      errorMessage: analysis.errorMessage,
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
