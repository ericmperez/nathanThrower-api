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

// Helper to calculate current week/day based on enrollment start date
function calculateCurrentPosition(startDate: Date, totalWeeks: number): { week: number; day: number; daysSinceStart: number; isComplete: boolean } {
  const now = new Date();
  const start = new Date(startDate);

  // Reset time to midnight for accurate day calculation
  now.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);

  const diffTime = now.getTime() - start.getTime();
  const daysSinceStart = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  // Each week has 7 days
  const totalDays = totalWeeks * 7;

  if (daysSinceStart >= totalDays) {
    // Program is complete
    return { week: totalWeeks, day: 7, daysSinceStart, isComplete: true };
  }

  if (daysSinceStart < 0) {
    // Program hasn't started yet (shouldn't happen but handle it)
    return { week: 1, day: 1, daysSinceStart: 0, isComplete: false };
  }

  // Calculate week (1-indexed) and day (1-7)
  const week = Math.floor(daysSinceStart / 7) + 1;
  const day = (daysSinceStart % 7) + 1;

  return { week, day, daysSinceStart, isComplete: false };
}

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

    // Calculate current position based on date (not manual progression)
    const { week: currentWeek, day: currentDay, daysSinceStart, isComplete } = calculateCurrentPosition(
      enrollment.startDate,
      enrollment.program.durationWeeks
    );

    // Update enrollment status if program is complete
    if (isComplete && enrollment.status === 'active') {
      await prisma.userProgramEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'completed' },
      });
    }

    // Get today's workout
    const currentWeekData = enrollment.program.weeks.find(
      (w) => w.weekNumber === currentWeek
    );
    const todayDay = currentWeekData?.days.find(
      (d) => d.dayNumber === currentDay
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
        currentWeek,
        currentDay,
        totalWeeks: enrollment.program.durationWeeks,
        totalDays: enrollment.program.durationWeeks * 7,
        daysSinceStart,
        completedDays: enrollment.completedDays,
        startDate: enrollment.startDate,
        status: isComplete ? 'completed' : enrollment.status,
      },
      todayWorkout: todayDay ? {
        weekNumber: currentWeek,
        weekTitle: currentWeekData?.title,
        dayNumber: currentDay,
        dayTitle: todayDay.title,
        dayId: todayDay.id,
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

// POST /training-programs/me/complete-day - Mark today's workout as complete (tracking only)
// Days advance automatically based on calendar date, not completion
router.post('/me/complete-day', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const { dayId } = req.body; // Optional: specific day ID to mark complete

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

    // Calculate current position based on date
    const { week: currentWeek, day: currentDay, isComplete: programComplete } = calculateCurrentPosition(
      enrollment.startDate,
      enrollment.program.durationWeeks
    );

    // Get today's day data
    const currentWeekData = enrollment.program.weeks.find(
      (w) => w.weekNumber === currentWeek
    );
    const todayDay = currentWeekData?.days.find(
      (d) => d.dayNumber === currentDay
    );

    if (!todayDay) {
      return res.status(400).json({ error: 'Today\'s workout not found' });
    }

    // Verify they're completing today's workout (not a past or future day)
    if (dayId && dayId !== todayDay.id) {
      return res.status(400).json({
        error: 'Cannot complete this day',
        message: 'You can only complete today\'s workout. Past days cannot be recovered.',
      });
    }

    // Check if already completed today
    if (enrollment.completedDays.includes(todayDay.id)) {
      return res.json({
        message: 'Already completed',
        alreadyCompleted: true,
        enrollment: {
          id: enrollment.id,
          programId: enrollment.programId,
          currentWeek,
          currentDay,
          status: enrollment.status,
          completedDays: enrollment.completedDays,
        },
      });
    }

    // Add today to completed days
    const completedDays = [...enrollment.completedDays, todayDay.id];

    // Update enrollment
    const updatedEnrollment = await prisma.userProgramEnrollment.update({
      where: { id: enrollment.id },
      data: {
        completedDays,
        status: programComplete ? 'completed' : 'active',
      },
    });

    // Log workout activity
    await prisma.workoutLog.create({
      data: {
        userId,
        courseId: null,
        lessonId: null,
        activityType: 'training_program_day',
        notes: `Completed ${enrollment.program.title} - Week ${currentWeek}, Day ${currentDay}`,
      },
    });

    // Update user streak
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      await prisma.userStreak.upsert({
        where: { userId },
        create: {
          userId,
          currentStreak: 1,
          longestStreak: 1,
          lastActivityDate: today,
          streakStartDate: today,
        },
        update: {
          lastActivityDate: today,
          currentStreak: { increment: 1 },
        },
      });
    } catch (e) {
      // Streak update is not critical
    }

    res.json({
      message: 'Day completed!',
      enrollment: {
        id: updatedEnrollment.id,
        programId: updatedEnrollment.programId,
        currentWeek,
        currentDay,
        status: updatedEnrollment.status,
        completedDays: updatedEnrollment.completedDays,
        isComplete: programComplete,
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

// ============================================
// ADMIN ROUTES - Dashboard Management
// ============================================

// Helper to check if user is admin
async function isAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.role === 'admin' || user?.role === 'nathan';
}

// GET /training-programs/admin/all - List all programs (including inactive)
router.get('/admin/all', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const programs = await prisma.trainingProgram.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        weeks: {
          include: { days: true },
          orderBy: { weekNumber: 'asc' },
        },
        _count: { select: { enrollments: true } },
      },
    });

    res.json({ programs });
  } catch (error) {
    next(error);
  }
});

// POST /training-programs/admin - Create new program
router.post('/admin', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { title, description, category, difficulty, durationWeeks, thumbnailUrl, isPremium } = req.body;

    const program = await prisma.trainingProgram.create({
      data: {
        title,
        description,
        category: category || 'general',
        difficulty: difficulty || 'intermediate',
        durationWeeks: durationWeeks || 4,
        thumbnailUrl,
        isPremium: isPremium ?? true,
        isActive: true,
      },
    });

    res.status(201).json({ program });
  } catch (error) {
    next(error);
  }
});

// PUT /training-programs/admin/:id - Update program
router.put('/admin/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;
    const { title, description, category, difficulty, durationWeeks, thumbnailUrl, isPremium, isActive } = req.body;

    const program = await prisma.trainingProgram.update({
      where: { id },
      data: {
        title,
        description,
        category,
        difficulty,
        durationWeeks,
        thumbnailUrl,
        isPremium,
        isActive,
      },
    });

    res.json({ program });
  } catch (error) {
    next(error);
  }
});

// DELETE /training-programs/admin/:id - Delete program
router.delete('/admin/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;

    // Soft delete by setting isActive to false
    await prisma.trainingProgram.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({ message: 'Program deleted' });
  } catch (error) {
    next(error);
  }
});

// POST /training-programs/admin/:programId/weeks - Add week to program
router.post('/admin/:programId/weeks', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { programId } = req.params;
    const { weekNumber, title, description } = req.body;

    const week = await prisma.trainingProgramWeek.create({
      data: {
        programId,
        weekNumber,
        title,
        description,
      },
    });

    res.status(201).json({ week });
  } catch (error) {
    next(error);
  }
});

// PUT /training-programs/admin/weeks/:weekId - Update week
router.put('/admin/weeks/:weekId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { weekId } = req.params;
    const { title, description } = req.body;

    const week = await prisma.trainingProgramWeek.update({
      where: { id: weekId },
      data: { title, description },
    });

    res.json({ week });
  } catch (error) {
    next(error);
  }
});

// POST /training-programs/admin/weeks/:weekId/days - Add day to week
router.post('/admin/weeks/:weekId/days', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { weekId } = req.params;
    const { dayNumber, title, drillIds, notes, restDay } = req.body;

    const day = await prisma.trainingProgramDay.create({
      data: {
        weekId,
        dayNumber,
        title,
        drillIds: drillIds || [],
        notes,
        restDay: restDay || false,
      },
    });

    res.status(201).json({ day });
  } catch (error) {
    next(error);
  }
});

// PUT /training-programs/admin/days/:dayId - Update day
router.put('/admin/days/:dayId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { dayId } = req.params;
    const { title, drillIds, notes, restDay } = req.body;

    const day = await prisma.trainingProgramDay.update({
      where: { id: dayId },
      data: { title, drillIds, notes, restDay },
    });

    res.json({ day });
  } catch (error) {
    next(error);
  }
});

// GET /training-programs/admin/drills - List all drills
router.get('/admin/drills', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const drills = await prisma.drill.findMany({
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    });

    res.json({ drills });
  } catch (error) {
    next(error);
  }
});

// POST /training-programs/admin/drills - Create drill
router.post('/admin/drills', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { title, description, videoUrl, category, tags } = req.body;

    const drill = await prisma.drill.create({
      data: {
        title,
        description,
        videoUrl,
        category: category || 'general',
        tags: tags || [],
      },
    });

    res.status(201).json({ drill });
  } catch (error) {
    next(error);
  }
});

// PUT /training-programs/admin/drills/:drillId - Update drill
router.put('/admin/drills/:drillId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { drillId } = req.params;
    const { title, description, videoUrl, category, tags } = req.body;

    const drill = await prisma.drill.update({
      where: { id: drillId },
      data: { title, description, videoUrl, category, tags },
    });

    res.json({ drill });
  } catch (error) {
    next(error);
  }
});

// DELETE /training-programs/admin/drills/:drillId - Delete drill
router.delete('/admin/drills/:drillId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { drillId } = req.params;

    await prisma.drill.delete({ where: { id: drillId } });

    res.json({ message: 'Drill deleted' });
  } catch (error) {
    next(error);
  }
});

export default router;
