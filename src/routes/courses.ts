import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// List published courses
router.get('/', async (req, res, next) => {
  try {
    const courses = await prisma.course.findMany({
      where: { isPublished: true },
      include: {
        lessons: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            title: true,
            description: true,
            duration: true,
            order: true,
            isFree: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ items: courses });
  } catch (error) {
    next(error);
  }
});

// Get course detail
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const course = await prisma.course.findFirst({
      where: { id, isPublished: true },
      include: {
        lessons: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json(course);
  } catch (error) {
    next(error);
  }
});

// Get lesson detail (free lessons visible to all, paid require purchase)
router.get('/:courseId/lessons/:lessonId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { courseId, lessonId } = req.params;
    const userId = req.user!.userId;

    const lesson = await prisma.lesson.findFirst({
      where: { id: lessonId, courseId },
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Check if lesson is free or user has purchased
    if (!lesson.isFree) {
      const purchase = await prisma.purchase.findFirst({
        where: {
          userId,
          courseId,
          status: 'completed',
        },
      });

      if (!purchase) {
        return res.status(403).json({
          error: 'Purchase required',
          message: 'This lesson requires purchasing the course',
        });
      }
    }

    res.json(lesson);
  } catch (error) {
    next(error);
  }
});

// Mock purchase endpoint (for MVP without real Stripe integration)
router.post('/:id/purchase', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const course = await prisma.course.findUnique({ where: { id } });
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Check if already purchased
    const existing = await prisma.purchase.findUnique({
      where: {
        userId_courseId: { userId, courseId: id },
      },
    });

    if (existing) {
      return res.status(409).json({ error: 'Course already purchased' });
    }

    // Create mock purchase
    const purchase = await prisma.purchase.create({
      data: {
        userId,
        courseId: id,
        status: 'completed',
        provider: 'mock',
        receiptRef: `mock_${Date.now()}`,
      },
    });

    res.status(201).json(purchase);
  } catch (error) {
    next(error);
  }
});

export default router;
