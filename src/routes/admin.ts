import { Router } from 'express';
import { CreateCourseSchema, UpdateCourseSchema, CreateLessonSchema } from '../lib/shared';
import prisma from '../lib/prisma';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { broadcastSubscriptionUpdate, broadcastUserUpdate } from '../lib/websocket';

const router = Router();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// ==================== Dashboard Stats ====================

router.get('/stats', async (req: AuthRequest, res, next) => {
  try {
    const [
      totalUsers,
      activeSubscriptions,
      totalMessages,
      unreadMessages,
      totalAnalyses,
      recentSignups,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.subscription.count({ where: { status: 'active' } }),
      prisma.message.count(),
      prisma.message.count({ where: { isRead: false } }),
      prisma.analysis.count(),
      prisma.user.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // last 7 days
          },
        },
      }),
    ]);

    res.json({
      totalUsers,
      activeSubscriptions,
      totalMessages,
      unreadMessages,
      totalAnalyses,
      recentSignups,
    });
  } catch (error) {
    next(error);
  }
});

// ==================== Users ====================

router.get('/users', async (req: AuthRequest, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        subscription: {
          select: {
            plan: true,
            status: true,
            currentPeriodEnd: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ users });
  } catch (error) {
    next(error);
  }
});

// ==================== Courses ====================

// Create course
router.post('/courses', async (req: AuthRequest, res, next) => {
  try {
    const data = CreateCourseSchema.parse(req.body);

    const course = await prisma.course.create({
      data,
    });

    res.status(201).json(course);
  } catch (error) {
    next(error);
  }
});

// Update course
router.patch('/courses/:id', async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const data = UpdateCourseSchema.parse(req.body);

    const course = await prisma.course.update({
      where: { id },
      data,
    });

    res.json(course);
  } catch (error) {
    next(error);
  }
});

// Delete course
router.delete('/courses/:id', async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    await prisma.course.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ==================== Lessons ====================

// Create lesson
router.post('/lessons', async (req: AuthRequest, res, next) => {
  try {
    const data = CreateLessonSchema.parse(req.body);

    const lesson = await prisma.lesson.create({
      data,
    });

    res.status(201).json(lesson);
  } catch (error) {
    next(error);
  }
});

// Update lesson
router.patch('/lessons/:id', async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const lesson = await prisma.lesson.update({
      where: { id },
      data,
    });

    res.json(lesson);
  } catch (error) {
    next(error);
  }
});

// Delete lesson
router.delete('/lessons/:id', async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    await prisma.lesson.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ==================== Drills ====================

// Create drill
router.post('/drills', async (req: AuthRequest, res, next) => {
  try {
    const data = req.body;

    const drill = await prisma.drill.create({
      data,
    });

    res.status(201).json(drill);
  } catch (error) {
    next(error);
  }
});

// List all drills
router.get('/drills', async (req: AuthRequest, res, next) => {
  try {
    const drills = await prisma.drill.findMany({
      orderBy: { createdAt: 'desc' },
    });

    res.json({ items: drills });
  } catch (error) {
    next(error);
  }
});

// ==================== Pitch Count Limits ====================

// Create pitch count limit
router.post('/pitch-count-limits', async (req: AuthRequest, res, next) => {
  try {
    const { minAge, maxAge, sessionType, maxPitches, warningThreshold, restDaysAfter, notes, isActive } = req.body;

    if (!minAge || !maxAge || !sessionType || !maxPitches) {
      return res.status(400).json({ error: 'minAge, maxAge, sessionType, and maxPitches are required' });
    }

    const limit = await prisma.pitchCountLimit.create({
      data: {
        minAge: parseInt(minAge),
        maxAge: parseInt(maxAge),
        sessionType,
        maxPitches: parseInt(maxPitches),
        warningThreshold: warningThreshold ? parseInt(warningThreshold) : Math.floor(parseInt(maxPitches) * 0.8),
        restDaysAfter: restDaysAfter ? parseInt(restDaysAfter) : 1,
        notes,
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    res.status(201).json({ limit });
  } catch (error) {
    next(error);
  }
});

// Get all pitch count limits
router.get('/pitch-count-limits', async (req: AuthRequest, res, next) => {
  try {
    const limits = await prisma.pitchCountLimit.findMany({
      orderBy: [{ minAge: 'asc' }, { sessionType: 'asc' }],
    });

    res.json({ limits });
  } catch (error) {
    next(error);
  }
});

// Update pitch count limit
router.patch('/pitch-count-limits/:id', async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const updateData: any = {};

    if (req.body.minAge !== undefined) updateData.minAge = parseInt(req.body.minAge);
    if (req.body.maxAge !== undefined) updateData.maxAge = parseInt(req.body.maxAge);
    if (req.body.sessionType !== undefined) updateData.sessionType = req.body.sessionType;
    if (req.body.maxPitches !== undefined) updateData.maxPitches = parseInt(req.body.maxPitches);
    if (req.body.warningThreshold !== undefined) updateData.warningThreshold = parseInt(req.body.warningThreshold);
    if (req.body.restDaysAfter !== undefined) updateData.restDaysAfter = parseInt(req.body.restDaysAfter);
    if (req.body.notes !== undefined) updateData.notes = req.body.notes;
    if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;

    const limit = await prisma.pitchCountLimit.update({
      where: { id },
      data: updateData,
    });

    res.json({ limit });
  } catch (error) {
    next(error);
  }
});

// Delete pitch count limit
router.delete('/pitch-count-limits/:id', async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    await prisma.pitchCountLimit.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ==================== Rest Day Guidelines ====================

// Create rest day guideline
router.post('/rest-day-guidelines', async (req: AuthRequest, res, next) => {
  try {
    const { minAge, maxAge, pitchCountMin, pitchCountMax, restDays, notes, isActive } = req.body;

    if (!minAge || !maxAge || pitchCountMin === undefined || !restDays) {
      return res.status(400).json({ error: 'minAge, maxAge, pitchCountMin, and restDays are required' });
    }

    const guideline = await prisma.restDayGuideline.create({
      data: {
        minAge: parseInt(minAge),
        maxAge: parseInt(maxAge),
        pitchCountMin: parseInt(pitchCountMin),
        pitchCountMax: pitchCountMax ? parseInt(pitchCountMax) : null,
        restDays: parseInt(restDays),
        notes,
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    res.status(201).json({ guideline });
  } catch (error) {
    next(error);
  }
});

// Get all rest day guidelines
router.get('/rest-day-guidelines', async (req: AuthRequest, res, next) => {
  try {
    const guidelines = await prisma.restDayGuideline.findMany({
      orderBy: [{ minAge: 'asc' }, { pitchCountMin: 'asc' }],
    });

    res.json({ guidelines });
  } catch (error) {
    next(error);
  }
});

// Update rest day guideline
router.patch('/rest-day-guidelines/:id', async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const updateData: any = {};

    if (req.body.minAge !== undefined) updateData.minAge = parseInt(req.body.minAge);
    if (req.body.maxAge !== undefined) updateData.maxAge = parseInt(req.body.maxAge);
    if (req.body.pitchCountMin !== undefined) updateData.pitchCountMin = parseInt(req.body.pitchCountMin);
    if (req.body.pitchCountMax !== undefined) updateData.pitchCountMax = req.body.pitchCountMax === null ? null : parseInt(req.body.pitchCountMax);
    if (req.body.restDays !== undefined) updateData.restDays = parseInt(req.body.restDays);
    if (req.body.notes !== undefined) updateData.notes = req.body.notes;
    if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;

    const guideline = await prisma.restDayGuideline.update({
      where: { id },
      data: updateData,
    });

    res.json({ guideline });
  } catch (error) {
    next(error);
  }
});

// Delete rest day guideline
router.delete('/rest-day-guidelines/:id', async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    await prisma.restDayGuideline.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ==================== Subscriptions ====================

// Grant premium subscription to a user
router.post('/users/:userId/subscription', async (req: AuthRequest, res, next) => {
  try {
    const { userId } = req.params;
    const { plan = 'monthly', months = 1 } = req.body;

    // Find user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Calculate end date
    const endDate = new Date();
    if (plan === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + months);
    } else {
      endDate.setMonth(endDate.getMonth() + months);
    }

    // Create or update subscription
    const subscription = await prisma.subscription.upsert({
      where: { userId: user.id },
      update: {
        plan,
        status: 'active',
        provider: 'admin',
        currentPeriodStart: new Date(),
        currentPeriodEnd: endDate,
        cancelAtPeriodEnd: false,
      },
      create: {
        userId: user.id,
        plan,
        status: 'active',
        provider: 'admin',
        currentPeriodStart: new Date(),
        currentPeriodEnd: endDate,
        cancelAtPeriodEnd: false,
      },
    });

    // Broadcast real-time event
    broadcastSubscriptionUpdate(userId, subscription);
    broadcastUserUpdate(userId, user);

    res.json({
      success: true,
      subscription,
      message: `Premium subscription granted to ${user.email}`,
    });
  } catch (error) {
    next(error);
  }
});

// Revoke subscription
router.delete('/users/:userId/subscription', async (req: AuthRequest, res, next) => {
  try {
    const { userId } = req.params;

    const subscription = await prisma.subscription.findUnique({
      where: { userId },
    });

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const updatedSubscription = await prisma.subscription.update({
      where: { userId },
      data: {
        status: 'cancelled',
        cancelAtPeriodEnd: true,
      },
    });

    // Broadcast real-time event
    broadcastSubscriptionUpdate(userId, updatedSubscription);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      broadcastUserUpdate(userId, user);
    }

    res.json({ success: true, message: 'Subscription cancelled' });
  } catch (error) {
    next(error);
  }
});

export default router;
