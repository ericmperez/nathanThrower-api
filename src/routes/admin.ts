import { Router } from 'express';
import { CreateCourseSchema, UpdateCourseSchema, CreateLessonSchema } from '../lib/shared';
import prisma from '../lib/prisma';
import { authenticate, requireAdmin, requireSuperAdmin, AuthRequest } from '../middleware/auth';
import { broadcastSubscriptionUpdate, broadcastUserUpdate } from '../lib/websocket';
import { generatePresignedUploadUrl } from '../lib/s3';
import { generateFirebaseUploadUrl } from '../lib/firebase';
import bcrypt from 'bcryptjs';

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

// Create new user (subscriber)
router.post('/users', async (req: AuthRequest, res, next) => {
  try {
    const {
      email,
      password,
      firstName,
      lastName,
      age,
      role: requestedRole,
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!firstName) {
      return res.status(400).json({ error: 'First name is required' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Build full name from firstName and lastName
    const fullName = lastName ? `${firstName} ${lastName}` : firstName;

    // Determine role (only super admins can set admin role)
    let finalRole = 'user';
    if (requestedRole === 'admin') {
      const SUPER_ADMIN_EMAILS = ['nathan@nathanthrower.com', 'eric.perez.pr@gmail.com'];
      const isSuperAdmin = req.user?.role === 'nathan' || SUPER_ADMIN_EMAILS.includes(req.user?.email || '');
      if (isSuperAdmin) {
        finalRole = 'admin';
      }
    }

    // Create user with profile data
    const user = await prisma.user.create({
      data: {
        name: fullName,
        firstName,
        lastName: lastName || null,
        age: age ? parseInt(age, 10) : null,
        email,
        password: hashedPassword,
        role: finalRole,
        emailVerified: true, // Admin-created users are pre-verified
      },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        age: true,
        role: true,
        createdAt: true,
      },
    });

    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
});

// Get all users
router.get('/users', async (req: AuthRequest, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        age: true,
        language: true,
        role: true,
        profilePicture: true,
        endGoal: true,
        currentVelocity: true,
        targetVelocity: true,
        createdAt: true,
        subscription: {
          select: {
            plan: true,
            tier: true,
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

// Get single user by ID with all related data
router.get('/users/:userId', async (req: AuthRequest, res, next) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        age: true,
        language: true,
        role: true,
        handedness: true,
        profilePicture: true,
        endGoal: true,
        currentVelocity: true,
        targetVelocity: true,
        goals: true,
        createdAt: true,
        updatedAt: true,
        subscription: {
          select: {
            id: true,
            plan: true,
            tier: true,
            status: true,
            provider: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
            createdAt: true,
          },
        },
        // Pitch count sessions (last 20)
        pitchCountSessions: {
          take: 20,
          orderBy: { date: 'desc' },
          select: {
            id: true,
            sessionType: true,
            age: true,
            date: true,
            notes: true,
            pitches: {
              select: {
                id: true,
                pitchType: true,
                result: true,
              },
            },
          },
        },
        // Workout logs (last 30)
        workoutLogs: {
          take: 30,
          orderBy: { date: 'desc' },
          select: {
            id: true,
            activityType: true,
            date: true,
            duration: true,
            notes: true,
          },
        },
        // Streak data
        streak: {
          select: {
            currentStreak: true,
            longestStreak: true,
            lastActivityDate: true,
            streakStartDate: true,
          },
        },
        // Training program enrollments
        programEnrollments: {
          select: {
            id: true,
            currentWeek: true,
            currentDay: true,
            status: true,
            startDate: true,
            completedDays: true,
            program: {
              select: {
                id: true,
                title: true,
                category: true,
                difficulty: true,
                durationWeeks: true,
              },
            },
          },
        },
        // Video analyses (last 20)
        analyses: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            pitchType: true,
            handedness: true,
            goal: true,
            status: true,
            createdAt: true,
            videoAsset: {
              select: {
                url: true,
                thumbnailUrl: true,
              },
            },
          },
        },
        // Messages sent (last 50)
        sentMessages: {
          take: 50,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            content: true,
            createdAt: true,
            isRead: true,
            hasVideo: true,
            hasImage: true,
            receiver: {
              select: {
                id: true,
                name: true,
                role: true,
              },
            },
          },
        },
        // Messages received (last 50)
        receivedMessages: {
          take: 50,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            content: true,
            createdAt: true,
            isRead: true,
            hasVideo: true,
            hasImage: true,
            sender: {
              select: {
                id: true,
                name: true,
                role: true,
              },
            },
          },
        },
        // Course purchases
        purchases: {
          select: {
            id: true,
            status: true,
            provider: true,
            createdAt: true,
            course: {
              select: {
                id: true,
                title: true,
                price: true,
              },
            },
          },
        },
        // Referral code and referrals made
        referralCode: {
          select: {
            code: true,
            isActive: true,
            referrals: {
              select: {
                id: true,
                status: true,
                createdAt: true,
                referred: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        // Who referred this user
        referredBy: {
          select: {
            referrer: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Calculate age from dateOfBirth if available
    const calculatedAge = user.dateOfBirth
      ? Math.floor((Date.now() - new Date(user.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      : user.age;

    res.json({
      user: {
        ...user,
        calculatedAge,
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get user activity log
router.get('/users/:userId/activity', async (req: AuthRequest, res, next) => {
  try {
    const { userId } = req.params;

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true, updatedAt: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const activities: Array<{
      type: string;
      description: string;
      timestamp: Date;
      metadata?: any;
    }> = [];

    // Account creation
    activities.push({
      type: 'account_created',
      description: 'Account created',
      timestamp: user.createdAt,
    });

    // Profile updates
    if (user.updatedAt && user.updatedAt.getTime() !== user.createdAt.getTime()) {
      activities.push({
        type: 'profile_updated',
        description: 'Profile updated',
        timestamp: user.updatedAt,
      });
    }

    // Subscription history
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
    });

    if (subscription) {
      activities.push({
        type: 'subscription_created',
        description: `Subscription created: ${subscription.plan} (${subscription.status})`,
        timestamp: subscription.createdAt,
        metadata: { plan: subscription.plan, status: subscription.status },
      });

      if (subscription.updatedAt && subscription.updatedAt.getTime() !== subscription.createdAt.getTime()) {
        activities.push({
          type: 'subscription_updated',
          description: `Subscription updated: ${subscription.status}`,
          timestamp: subscription.updatedAt,
          metadata: { status: subscription.status, plan: subscription.plan },
        });
      }
    }

    // Video analyses
    const analyses = await prisma.analysis.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50, // Limit to recent 50
    });

    analyses.forEach((analysis) => {
      activities.push({
        type: 'analysis_submitted',
        description: `Video analysis submitted: ${analysis.pitchType} pitch (${analysis.goal})`,
        timestamp: analysis.createdAt,
        metadata: { status: analysis.status, pitchType: analysis.pitchType },
      });

      if (analysis.status === 'completed' && analysis.updatedAt) {
        activities.push({
          type: 'analysis_completed',
          description: `Video analysis completed: ${analysis.pitchType} pitch`,
          timestamp: analysis.updatedAt,
          metadata: { pitchType: analysis.pitchType },
        });
      }
    });

    // Messages sent
    const messagesSent = await prisma.message.findMany({
      where: { senderId: userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    messagesSent.forEach((msg) => {
      activities.push({
        type: 'message_sent',
        description: msg.hasVideo ? 'Message sent with video' : 'Message sent',
        timestamp: msg.createdAt,
      });
    });

    // Pitch count sessions
    const pitchSessions = await prisma.pitchCountSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        pitches: {
          select: { id: true },
        },
      },
    });

    pitchSessions.forEach((session) => {
      activities.push({
        type: 'pitch_session',
        description: `${session.sessionType} session: ${session.pitches.length} pitches`,
        timestamp: session.createdAt,
        metadata: { sessionType: session.sessionType, pitchCount: session.pitches.length },
      });
    });

    // Course purchases
    const purchases = await prisma.purchase.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        course: {
          select: { title: true },
        },
      },
    });

    purchases.forEach((purchase) => {
      activities.push({
        type: 'course_purchased',
        description: `Course purchased: ${purchase.course.title}`,
        timestamp: purchase.createdAt,
        metadata: { status: purchase.status, courseTitle: purchase.course.title },
      });
    });

    // Recent login activity (from refresh tokens)
    // Group by date to avoid duplicate entries for same day
    const recentTokens = await prisma.refreshToken.findMany({
      where: { userId, isRevoked: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Group by date (same day = one login entry)
    const loginDates = new Set<string>();
    recentTokens.forEach((token) => {
      const dateKey = token.createdAt.toISOString().split('T')[0]; // YYYY-MM-DD
      if (!loginDates.has(dateKey)) {
        loginDates.add(dateKey);
        activities.push({
          type: 'login',
          description: 'User logged in',
          timestamp: token.createdAt,
          metadata: { deviceId: token.deviceId },
        });
      }
    });


    // Sort all activities by timestamp (most recent first)
    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    res.json({
      userId,
      userName: user.name,
      userEmail: user.email,
      activities: activities.slice(0, 100), // Limit to 100 most recent
      totalActivities: activities.length,
    });
  } catch (error) {
    next(error);
  }
});

// ==================== User Role Management ====================

// Update user role (Super Admin only - nathan@nathanthrower.com and eric.perez.pr@gmail.com)
router.patch('/users/:userId/role', requireSuperAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    // Validate role
    const validRoles = ['user', 'admin'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({
        error: 'Invalid role. Allowed roles: user, admin',
        allowedRoles: validRoles
      });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent changing nathan's role
    if (user.role === 'nathan') {
      return res.status(403).json({ error: 'Cannot modify Nathan\'s role' });
    }

    // Update user role
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    // Broadcast update
    broadcastUserUpdate(userId, updatedUser);

    res.json({
      success: true,
      user: updatedUser,
      message: `User ${user.email} role updated to ${role}`,
    });
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

// Grant subscription to a user
router.post('/users/:userId/subscription', async (req: AuthRequest, res, next) => {
  try {
    const { userId } = req.params;
    const { plan = 'monthly', tier = 'premium', months = 1 } = req.body;

    // Validate tier
    const validTiers = ['premium', 'superplayer'];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier. Allowed: premium, superplayer' });
    }

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
        tier,
        status: 'active',
        provider: 'admin',
        currentPeriodStart: new Date(),
        currentPeriodEnd: endDate,
        cancelAtPeriodEnd: false,
      },
      create: {
        userId: user.id,
        plan,
        tier,
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

    const tierLabel = tier === 'superplayer' ? 'Superplayer' : 'Premium';
    res.json({
      success: true,
      subscription,
      message: `${tierLabel} subscription granted to ${user.email}`,
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

// ==================== Tip of the Week ====================

// Get presigned URL for uploading tip of the week video (Firebase Storage)
router.post('/tips-of-the-week/upload', async (req: AuthRequest, res, next) => {
  try {
    const { filename, contentType } = req.body;

    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and contentType are required' });
    }

    // Validate content type
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-m4v'];
    if (!allowedTypes.includes(contentType)) {
      return res.status(400).json({
        error: 'Invalid content type. Allowed: MP4, MOV, M4V',
        allowedTypes
      });
    }

    // Generate unique path for the video
    const timestamp = Date.now();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `content/tips/${timestamp}-${sanitizedFilename}`;

    const { uploadUrl, publicUrl } = await generateFirebaseUploadUrl(filePath, contentType);

    res.json({
      uploadUrl,
      videoUrl: publicUrl,
      filePath,
      expiresIn: 900, // 15 minutes
    });
  } catch (error) {
    next(error);
  }
});

// List all tips
router.get('/tips-of-the-week', async (req: AuthRequest, res, next) => {
  try {
    const tips = await prisma.tipOfTheWeek.findMany({
      orderBy: { publishedAt: 'desc' },
    });

    res.json({ tips });
  } catch (error) {
    next(error);
  }
});

// Create tip
router.post('/tips-of-the-week', async (req: AuthRequest, res, next) => {
  try {
    const { title, description, videoUrl, thumbnailUrl, publishedAt, expiresAt, isActive } = req.body;

    if (!title || !videoUrl) {
      return res.status(400).json({ error: 'Title and videoUrl are required' });
    }

    const tip = await prisma.tipOfTheWeek.create({
      data: {
        title,
        description,
        videoUrl,
        thumbnailUrl,
        publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    res.status(201).json({ tip });
  } catch (error) {
    next(error);
  }
});

// Update tip
router.patch('/tips-of-the-week/:id', async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, videoUrl, thumbnailUrl, publishedAt, expiresAt, isActive } = req.body;

    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (videoUrl !== undefined) updateData.videoUrl = videoUrl;
    if (thumbnailUrl !== undefined) updateData.thumbnailUrl = thumbnailUrl;
    if (publishedAt !== undefined) updateData.publishedAt = new Date(publishedAt);
    if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (isActive !== undefined) updateData.isActive = isActive;

    const tip = await prisma.tipOfTheWeek.update({
      where: { id },
      data: updateData,
    });

    res.json({ tip });
  } catch (error) {
    next(error);
  }
});

// Delete tip
router.delete('/tips-of-the-week/:id', async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    await prisma.tipOfTheWeek.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
