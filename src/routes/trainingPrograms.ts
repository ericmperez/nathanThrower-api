import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Helper to check if user has premium access (premium, pro, or elite)
async function hasPremiumAccess(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });

  // Admin override
  if (user?.role === 'admin' || user?.role === 'nathan') {
    return true;
  }

  const subscription = user?.subscription;
  if (!subscription) return false;

  const isActive = subscription.status === 'active'
    && subscription.currentPeriodEnd
    && new Date(subscription.currentPeriodEnd) > new Date();

  if (!isActive) return false;

  // Premium, Pro, and Elite all have access to training programs
  return ['premium', 'pro', 'elite'].includes(subscription.tier);
}

// GET /training-programs - List all active training programs
router.get('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const programs = await prisma.trainingProgram.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        difficulty: true,
        durationWeeks: true,
        thumbnailUrl: true,
        isPremium: true,
      },
    });

    res.json({ programs });
  } catch (error) {
    next(error);
  }
});

// GET /training-programs/me/current - Get current enrollment and today's workout
router.get('/me/current', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;

    // Check premium access
    const hasAccess = await hasPremiumAccess(userId);
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Premium required',
        message: 'Training programs require a Premium, Pro, or Elite subscription.',
      });
    }

    // Get active enrollment
    const enrollment = await prisma.userProgramEnrollment.findFirst({
      where: {
        userId,
        status: 'active',
      },
      include: {
        program: {
          include: {
            weeks: {
              include: {
                days: true,
              },
              orderBy: { weekNumber: 'asc' },
            },
          },
        },
      },
    });

    if (!enrollment) {
      return res.json({ enrollment: null, todayWorkout: null });
    }

    // Get today's workout
    const currentWeek = enrollment.program.weeks.find(
      (w) => w.weekNumber === enrollment.currentWeek
    );
    const todayDay = currentWeek?.days.find(
      (d) => d.dayNumber === enrollment.currentDay
    );

    // Get drills for today if any
    let drills: any[] = [];
    if (todayDay && todayDay.drillIds.length > 0) {
      drills = await prisma.drill.findMany({
        where: { id: { in: todayDay.drillIds } },
      });
    }

    res.json({
      enrollment: {
        id: enrollment.id,
        programId: enrollment.programId,
        programTitle: enrollment.program.title,
        programCategory: enrollment.program.category,
        currentWeek: enrollment.currentWeek,
        currentDay: enrollment.currentDay,
        totalWeeks: enrollment.program.durationWeeks,
        completedDays: enrollment.completedDays,
        startDate: enrollment.startDate,
        status: enrollment.status,
      },
      todayWorkout: todayDay ? {
        weekNumber: enrollment.currentWeek,
        weekTitle: currentWeek?.title,
        dayNumber: enrollment.currentDay,
        dayTitle: todayDay.title,
        restDay: todayDay.restDay,
        notes: todayDay.notes,
        drills,
        isCompleted: enrollment.completedDays.includes(todayDay.id),
      } : null,
    });
  } catch (error) {
    next(error);
  }
});

// GET /training-programs/:id - Get program details
router.get('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    const program = await prisma.trainingProgram.findUnique({
      where: { id },
      include: {
        weeks: {
          include: {
            days: true,
          },
          orderBy: { weekNumber: 'asc' },
        },
      },
    });

    if (!program) {
      return res.status(404).json({ error: 'Program not found' });
    }

    res.json({ program });
  } catch (error) {
    next(error);
  }
});

// POST /training-programs/:id/enroll - Enroll in a program
router.post('/:id/enroll', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    // Check premium access
    const hasAccess = await hasPremiumAccess(userId);
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Premium required',
        message: 'Training programs require a Premium, Pro, or Elite subscription.',
      });
    }

    // Check if program exists and is active
    const program = await prisma.trainingProgram.findUnique({
      where: { id },
    });

    if (!program || !program.isActive) {
      return res.status(404).json({ error: 'Program not found' });
    }

    // Check if already enrolled in this program
    const existingEnrollment = await prisma.userProgramEnrollment.findUnique({
      where: {
        userId_programId: { userId, programId: id },
      },
    });

    if (existingEnrollment && existingEnrollment.status === 'active') {
      return res.status(400).json({
        error: 'Already enrolled',
        message: 'You are already enrolled in this program.',
      });
    }

    // Cancel any other active enrollments (one program at a time)
    await prisma.userProgramEnrollment.updateMany({
      where: {
        userId,
        status: 'active',
      },
      data: { status: 'paused' },
    });

    // Create or update enrollment
    const enrollment = await prisma.userProgramEnrollment.upsert({
      where: {
        userId_programId: { userId, programId: id },
      },
      create: {
        userId,
        programId: id,
        currentWeek: 1,
        currentDay: 1,
        status: 'active',
        completedDays: [],
      },
      update: {
        currentWeek: 1,
        currentDay: 1,
        status: 'active',
        completedDays: [],
        startDate: new Date(),
      },
    });

    res.status(201).json({
      message: 'Successfully enrolled in program',
      enrollment: {
        id: enrollment.id,
        programId: enrollment.programId,
        currentWeek: enrollment.currentWeek,
        currentDay: enrollment.currentDay,
        status: enrollment.status,
        startDate: enrollment.startDate,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /training-programs/me/complete-day - Mark current day as complete
router.post('/me/complete-day', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;

    // Get active enrollment
    const enrollment = await prisma.userProgramEnrollment.findFirst({
      where: {
        userId,
        status: 'active',
      },
      include: {
        program: {
          include: {
            weeks: {
              include: {
                days: true,
              },
              orderBy: { weekNumber: 'asc' },
            },
          },
        },
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        error: 'No active enrollment',
        message: 'You are not enrolled in any training program.',
      });
    }

    // Get current day
    const currentWeek = enrollment.program.weeks.find(
      (w) => w.weekNumber === enrollment.currentWeek
    );
    const currentDay = currentWeek?.days.find(
      (d) => d.dayNumber === enrollment.currentDay
    );

    if (!currentDay) {
      return res.status(400).json({ error: 'Current day not found' });
    }

    // Add day to completed if not already
    const completedDays = enrollment.completedDays.includes(currentDay.id)
      ? enrollment.completedDays
      : [...enrollment.completedDays, currentDay.id];

    // Calculate next day/week
    let nextDay = enrollment.currentDay + 1;
    let nextWeek = enrollment.currentWeek;
    let isComplete = false;

    // Check if we need to move to next week
    const daysInCurrentWeek = currentWeek?.days.length || 7;
    if (nextDay > daysInCurrentWeek) {
      nextDay = 1;
      nextWeek = enrollment.currentWeek + 1;

      // Check if program is complete
      if (nextWeek > enrollment.program.durationWeeks) {
        isComplete = true;
      }
    }

    // Update enrollment
    const updatedEnrollment = await prisma.userProgramEnrollment.update({
      where: { id: enrollment.id },
      data: {
        completedDays,
        currentDay: isComplete ? enrollment.currentDay : nextDay,
        currentWeek: isComplete ? enrollment.currentWeek : nextWeek,
        status: isComplete ? 'completed' : 'active',
      },
    });

    // Log workout activity
    await prisma.workoutLog.create({
      data: {
        userId,
        courseId: null,
        lessonId: null,
        activityType: 'training_program_day',
        notes: `Completed ${enrollment.program.title} - Week ${enrollment.currentWeek}, Day ${enrollment.currentDay}`,
      },
    });

    res.json({
      message: isComplete ? 'Program completed!' : 'Day completed!',
      enrollment: {
        id: updatedEnrollment.id,
        programId: updatedEnrollment.programId,
        currentWeek: updatedEnrollment.currentWeek,
        currentDay: updatedEnrollment.currentDay,
        status: updatedEnrollment.status,
        completedDays: updatedEnrollment.completedDays,
        isComplete,
      },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /training-programs/me/unenroll - Cancel current enrollment
router.delete('/me/unenroll', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;

    const enrollment = await prisma.userProgramEnrollment.findFirst({
      where: {
        userId,
        status: 'active',
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        error: 'No active enrollment',
        message: 'You are not enrolled in any training program.',
      });
    }

    await prisma.userProgramEnrollment.update({
      where: { id: enrollment.id },
      data: { status: 'cancelled' },
    });

    res.json({ message: 'Successfully unenrolled from program' });
  } catch (error) {
    next(error);
  }
});

export default router;
