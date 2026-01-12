import { Router } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// Get current tip of the week
// Returns the most recent active tip that hasn't expired
router.get('/tip-of-the-week', async (req, res, next) => {
  try {
    const now = new Date();

    const tip = await prisma.tipOfTheWeek.findFirst({
      where: {
        isActive: true,
        publishedAt: { lte: now },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        videoUrl: true,
        thumbnailUrl: true,
        publishedAt: true,
        expiresAt: true,
      },
    });

    if (!tip) {
      return res.status(404).json({ error: 'No tip of the week available' });
    }

    res.json(tip);
  } catch (error) {
    next(error);
  }
});

export default router;
