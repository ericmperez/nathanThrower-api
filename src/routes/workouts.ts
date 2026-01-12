import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { startOfDay, endOfDay, subDays, differenceInCalendarDays } from 'date-fns';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * Log a workout activity
 * POST /api/workouts/log
 *
 * Only available to coaching students (users with role 'player' who are assigned to a coach)
 * For MVP, we'll allow any authenticated user to log workouts
 */
router.post('/log', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const { courseId, lessonId, activityType, duration, notes } = req.body;

    // Validate activity type
    const validTypes = ['lesson_complete', 'course_complete', 'drill', 'pitch_session'];
    if (!activityType || !validTypes.includes(activityType)) {
      return res.status(400).json({
        error: 'Invalid activity type',
        message: `Activity type must be one of: ${validTypes.join(', ')}`,
      });
    }

    // Get today's date (normalized to start of day for consistency)
    const today = startOfDay(new Date());

    // Check if this exact activity was already logged today
    const existingLog = await prisma.workoutLog.findFirst({
      where: {
        userId,
        date: {
          gte: today,
          lt: endOfDay(today),
        },
        courseId: courseId || null,
        lessonId: lessonId || null,
        activityType,
      },
    });

    if (existingLog) {
      // Update existing log instead of creating duplicate
      const updatedLog = await prisma.workoutLog.update({
        where: { id: existingLog.id },
        data: {
          duration: duration ? (existingLog.duration || 0) + duration : existingLog.duration,
          notes: notes || existingLog.notes,
          updatedAt: new Date(),
        },
      });

      // Still update streak since user is active
      await updateStreak(userId, today);

      return res.json({
        message: 'Activity updated',
        log: updatedLog,
        streak: await getStreakData(userId),
      });
    }

    // Create new workout log
    const workoutLog = await prisma.workoutLog.create({
      data: {
        userId,
        courseId: courseId || null,
        lessonId: lessonId || null,
        activityType,
        date: today,
        duration: duration || null,
        notes: notes || null,
      },
    });

    // Update streak
    await updateStreak(userId, today);

    res.status(201).json({
      message: 'Activity logged successfully',
      log: workoutLog,
      streak: await getStreakData(userId),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get streak data for the current user
 * GET /api/workouts/streak
 */
router.get('/streak', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const streakData = await getStreakData(userId);
    res.json(streakData);
  } catch (error) {
    next(error);
  }
});

/**
 * Get workout history for the current user
 * GET /api/workouts/history
 */
router.get('/history', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const { days = 30 } = req.query;

    const startDate = subDays(new Date(), Number(days));

    const logs = await prisma.workoutLog.findMany({
      where: {
        userId,
        date: { gte: startDate },
      },
      orderBy: { date: 'desc' },
      include: {
        user: {
          select: { name: true },
        },
      },
    });

    res.json({ logs });
  } catch (error) {
    next(error);
  }
});

/**
 * Get recent activity feed for the current user
 * GET /api/workouts/activity
 * 
 * Returns a combined feed of all user activities:
 * - Workout logs (lessons, drills, pitch sessions)
 * - Video analyses
 * - Pitch count sessions
 */
router.get('/activity', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const { limit = 5, page = 1 } = req.query;
    const take = Math.min(Number(limit), 50);
    const skip = (Number(page) - 1) * take;

    // Fetch all activity types in parallel
    const [workoutLogs, analyses, pitchSessions] = await Promise.all([
      // Workout logs
      prisma.workoutLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: take * 2, // Fetch more to ensure we have enough after combining
      }),
      // Video analyses
      prisma.analysis.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: take * 2,
        include: {
          videoAsset: {
            select: { thumbnailUrl: true },
          },
        },
      }),
      // Pitch count sessions
      prisma.pitchCountSession.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: take * 2,
        include: {
          pitches: {
            select: { id: true },
          },
        },
      }),
    ]);

    // Transform all activities to a common format
    const activities: {
      id: string;
      type: string;
      title: string;
      subtitle: string;
      icon: string;
      color: string;
      timestamp: Date;
      metadata?: Record<string, any>;
    }[] = [];

    // Add workout logs
    for (const log of workoutLogs) {
      let title = '';
      let icon = '';
      let color = '';

      switch (log.activityType) {
        case 'lesson_complete':
          title = 'Completed a lesson';
          icon = 'book';
          color = '#3B82F6'; // blue
          break;
        case 'course_complete':
          title = 'Completed a course';
          icon = 'trophy';
          color = '#F59E0B'; // amber
          break;
        case 'drill':
          title = 'Completed a drill';
          icon = 'fitness';
          color = '#10B981'; // green
          break;
        case 'pitch_session':
          title = 'Pitch session logged';
          icon = 'baseball';
          color = '#8B5CF6'; // purple
          break;
        default:
          title = 'Activity completed';
          icon = 'checkmark-circle';
          color = '#6B7280'; // gray
      }

      activities.push({
        id: log.id,
        type: log.activityType,
        title,
        subtitle: log.notes || formatRelativeTime(log.createdAt),
        icon,
        color,
        timestamp: log.createdAt,
        metadata: {
          courseId: log.courseId,
          lessonId: log.lessonId,
          duration: log.duration,
        },
      });
    }

    // Add analyses
    for (const analysis of analyses) {
      let statusText = '';
      let icon = '';
      let color = '';

      switch (analysis.status) {
        case 'completed':
          statusText = 'Analysis complete';
          icon = 'analytics';
          color = '#10B981'; // green
          break;
        case 'processing':
          statusText = 'Analysis in progress';
          icon = 'hourglass';
          color = '#F59E0B'; // amber
          break;
        case 'queued':
          statusText = 'Video queued for analysis';
          icon = 'time';
          color = '#6B7280'; // gray
          break;
        case 'failed':
          statusText = 'Analysis failed';
          icon = 'alert-circle';
          color = '#EF4444'; // red
          break;
        default:
          statusText = 'Video uploaded';
          icon = 'videocam';
          color = '#3B82F6'; // blue
      }

      activities.push({
        id: analysis.id,
        type: 'analysis',
        title: statusText,
        subtitle: `${analysis.pitchType} pitch • ${analysis.goal}`,
        icon,
        color,
        timestamp: analysis.createdAt,
        metadata: {
          status: analysis.status,
          pitchType: analysis.pitchType,
          thumbnailUrl: analysis.videoAsset?.thumbnailUrl,
        },
      });
    }

    // Add pitch count sessions
    for (const session of pitchSessions) {
      const pitchCount = session.pitches.length;
      activities.push({
        id: session.id,
        type: 'pitch_count',
        title: `${session.sessionType === 'game' ? 'Game' : 'Bullpen'} session`,
        subtitle: `${pitchCount} pitches logged`,
        icon: 'baseball',
        color: '#8B5CF6', // purple
        timestamp: session.createdAt,
        metadata: {
          sessionType: session.sessionType,
          pitchCount,
          age: session.age,
        },
      });
    }

    // Sort all activities by timestamp (newest first)
    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Get total count for pagination
    const totalCount = activities.length;

    // Apply pagination
    const paginatedActivities = activities.slice(skip, skip + take);

    // Get user's account creation date
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });

    res.json({
      activities: paginatedActivities,
      pagination: {
        page: Number(page),
        limit: take,
        total: totalCount,
        hasMore: skip + take < totalCount,
      },
      memberSince: user?.createdAt?.toISOString() || null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Helper: Format relative time
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Helper: Update user's streak based on activity
 */
async function updateStreak(userId: string, activityDate: Date): Promise<void> {
  const today = startOfDay(activityDate);
  const yesterday = startOfDay(subDays(today, 1));

  // Get or create streak record
  let streak = await prisma.userStreak.findUnique({
    where: { userId },
  });

  if (!streak) {
    // First activity ever - start streak at 1
    await prisma.userStreak.create({
      data: {
        userId,
        currentStreak: 1,
        longestStreak: 1,
        lastActivityDate: today,
        streakStartDate: today,
      },
    });
    return;
  }

  // Check if already logged activity today
  if (streak.lastActivityDate) {
    const lastActivity = startOfDay(streak.lastActivityDate);
    const daysDiff = differenceInCalendarDays(today, lastActivity);

    if (daysDiff === 0) {
      // Already active today, no streak update needed
      return;
    } else if (daysDiff === 1) {
      // Consecutive day - increment streak
      const newStreak = streak.currentStreak + 1;
      await prisma.userStreak.update({
        where: { userId },
        data: {
          currentStreak: newStreak,
          longestStreak: Math.max(newStreak, streak.longestStreak),
          lastActivityDate: today,
        },
      });
    } else {
      // Missed days - reset streak to 1
      await prisma.userStreak.update({
        where: { userId },
        data: {
          currentStreak: 1,
          lastActivityDate: today,
          streakStartDate: today,
        },
      });
    }
  } else {
    // No previous activity - start streak
    await prisma.userStreak.update({
      where: { userId },
      data: {
        currentStreak: 1,
        longestStreak: Math.max(1, streak.longestStreak),
        lastActivityDate: today,
        streakStartDate: today,
      },
    });
  }
}

/**
 * Helper: Get streak data for a user
 */
async function getStreakData(userId: string) {
  const today = startOfDay(new Date());
  const weekAgo = subDays(today, 6); // Last 7 days including today

  // Get streak record
  const streak = await prisma.userStreak.findUnique({
    where: { userId },
  });

  // Get activity for last 7 days
  const recentLogs = await prisma.workoutLog.findMany({
    where: {
      userId,
      date: {
        gte: weekAgo,
        lte: endOfDay(today),
      },
    },
    select: { date: true },
  });

  // Build streak days array (last 7 days)
  const streakDays: boolean[] = [];
  for (let i = 6; i >= 0; i--) {
    const checkDate = startOfDay(subDays(today, i));
    const hasActivity = recentLogs.some(log => {
      const logDate = startOfDay(log.date);
      return differenceInCalendarDays(checkDate, logDate) === 0;
    });
    streakDays.push(hasActivity);
  }

  // Check if streak is still valid (activity today or yesterday)
  let currentStreak = streak?.currentStreak || 0;
  if (streak?.lastActivityDate) {
    const lastActivity = startOfDay(streak.lastActivityDate);
    const daysSinceActivity = differenceInCalendarDays(today, lastActivity);

    // If more than 1 day has passed without activity, streak is broken
    if (daysSinceActivity > 1) {
      currentStreak = 0;
      // Update the database to reflect broken streak
      await prisma.userStreak.update({
        where: { userId },
        data: {
          currentStreak: 0,
          streakStartDate: null,
        },
      });
    }
  }

  return {
    currentStreak,
    longestStreak: streak?.longestStreak || 0,
    lastActivityDate: streak?.lastActivityDate?.toISOString() || null,
    streakStartDate: streak?.streakStartDate?.toISOString() || null,
    streakDays, // [6 days ago, 5 days ago, ..., today]
    todayComplete: streakDays[6], // Is today marked as complete?
  };
}

export default router;
