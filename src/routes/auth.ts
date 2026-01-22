import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authRateLimit } from '../middleware/rateLimit';
import { broadcastUserCreated } from '../lib/websocket';
import { generatePresignedUploadUrl } from '../lib/s3';
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  logoutAllDevices,
  getUserSessions,
  revokeSession,
  generatePasswordResetToken,
  resetPassword,
  verifyEmail,
  resendEmailVerification,
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
} from '../services/authService';
import {
  verifyGoogleToken,
  verifyAppleToken,
  findOrCreateOAuthUser,
} from '../services/oauthService';
import { generateAccessToken, generateRefreshToken, getRefreshTokenExpiry } from '../lib/jwt';

const router = Router();

// Helper to get IP address from request
function getIpAddress(req: any): string | undefined {
  return (
    req.ip ||
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket.remoteAddress
  );
}

// Register
router.post('/register', authRateLimit, async (req, res, next) => {
  try {
    const deviceId = req.headers['x-device-id'] as string | undefined;
    const authResponse = await registerUser(req.body, deviceId);

    // Broadcast new user event to admins
    const user = await prisma.user.findUnique({
      where: { id: authResponse.user.id },
    });
    if (user) {
      broadcastUserCreated(user);
    }

    res.status(201).json(authResponse);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    if (error.message === 'Email already registered') {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
});

// Login
router.post('/login', authRateLimit, async (req, res, next) => {
  try {
    const deviceId = req.headers['x-device-id'] as string | undefined;
    const ipAddress = getIpAddress(req);
    const authResponse = await loginUser(req.body, deviceId, ipAddress);
    res.json(authResponse);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    if (error.message === 'Invalid credentials') {
      return res.status(401).json({ error: error.message });
    }
    if (error.message.includes('locked')) {
      return res.status(423).json({ error: error.message });
    }
    next(error);
  }
});

// Refresh token - exchange refresh token for new access token
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const result = await refreshAccessToken(refreshToken);
    res.json(result);
  } catch (error: any) {
    if (error.message.includes('Invalid') || error.message.includes('expired') || error.message.includes('revoked')) {
      return res.status(401).json({ error: error.message });
    }
    next(error);
  }
});

// Logout - revoke the refresh token
router.post('/logout', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { refreshToken } = req.body;
    const ipAddress = getIpAddress(req);
    await logoutUser(req.user!.userId, refreshToken, ipAddress);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
});

// Logout all devices - revoke all refresh tokens for the user
router.post('/logout-all', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const ipAddress = getIpAddress(req);
    await logoutAllDevices(req.user!.userId, ipAddress);
    res.json({ message: 'Logged out from all devices' });
  } catch (error) {
    next(error);
  }
});

// Get current user
router.get('/me', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        age: true,
        language: true,
        role: true,
        goals: true,
        handedness: true,
        endGoal: true,
        currentVelocity: true,
        targetVelocity: true,
        profilePicture: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        subscription: {
          select: {
            plan: true,
            status: true,
            currentPeriodEnd: true,
            provider: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// Get presigned URL for profile picture upload
router.post('/profile/picture/presign', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { contentType, filename } = req.body;
    const userId = req.user!.userId;

    // Validate content type (images only)
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!contentType || !allowedTypes.includes(contentType)) {
      return res.status(400).json({
        error: 'Invalid file type',
        message: `Allowed types: ${allowedTypes.join(', ')}`,
        allowedTypes,
      });
    }

    // Validate file size (max 5MB for profile pictures)
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    if (req.body.sizeBytes && req.body.sizeBytes > MAX_SIZE) {
      return res.status(400).json({
        error: 'File size exceeds limit',
        message: `Maximum file size is ${MAX_SIZE / (1024 * 1024)}MB`,
        maxSizeBytes: MAX_SIZE,
      });
    }

    // Generate unique key for profile picture
    const ext = filename?.split('.').pop() || contentType.split('/')[1] || 'jpg';
    const key = `profile-pictures/${userId}/${uuidv4()}.${ext}`;

    // Generate presigned URL
    const { uploadUrl, publicUrl } = await generatePresignedUploadUrl(
      key,
      contentType
    );

    res.json({
      uploadUrl,
      pictureKey: key,
      publicUrl,
      maxSizeBytes: MAX_SIZE,
      allowedContentTypes: allowedTypes,
    });
  } catch (error: any) {
    console.error('Profile picture presign error:', error);
    next(error);
  }
});

// Update profile
router.patch('/profile', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { name, email, firstName, lastName, age, dateOfBirth, language, role, goals, profilePicture, endGoal, currentVelocity, targetVelocity, handedness } = req.body;
    const userId = req.user!.userId;

    // Validate input
    if (name !== undefined && (typeof name !== 'string' || name.length < 2)) {
      return res.status(400).json({ error: 'Name must be at least 2 characters' });
    }
    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (firstName !== undefined && (typeof firstName !== 'string' || firstName.length < 1)) {
      return res.status(400).json({ error: 'First name must be at least 1 character' });
    }
    if (lastName !== undefined && (typeof lastName !== 'string' || lastName.length < 1)) {
      return res.status(400).json({ error: 'Last name must be at least 1 character' });
    }
    if (age !== undefined && (typeof age !== 'number' || age < 1 || age > 120)) {
      return res.status(400).json({ error: 'Age must be between 1 and 120' });
    }
    // Validate dateOfBirth - should be a valid ISO date string
    let parsedDateOfBirth: Date | undefined;
    if (dateOfBirth !== undefined) {
      if (typeof dateOfBirth !== 'string') {
        return res.status(400).json({ error: 'Date of birth must be an ISO date string' });
      }
      parsedDateOfBirth = new Date(dateOfBirth);
      if (isNaN(parsedDateOfBirth.getTime())) {
        return res.status(400).json({ error: 'Invalid date of birth format' });
      }
      // Validate reasonable age range (1-100 years old)
      const today = new Date();
      const age = today.getFullYear() - parsedDateOfBirth.getFullYear();
      if (age < 1 || age > 100) {
        return res.status(400).json({ error: 'Date of birth must result in age between 1 and 100' });
      }
    }
    if (language !== undefined && !['en', 'es'].includes(language)) {
      return res.status(400).json({ error: 'Language must be "en" or "es"' });
    }
    if (role !== undefined && !['user', 'admin', 'nathan', 'dad', 'coach', 'player'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const validGoals = ['velo', 'command', 'injury_prevention', 'mechanics', 'endurance'];
    if (goals !== undefined) {
      if (!Array.isArray(goals) || !goals.every((g: any) => typeof g === 'string' && validGoals.includes(g))) {
        return res.status(400).json({ error: `Goals must be an array containing only: ${validGoals.join(', ')}` });
      }
    }
    const validEndGoals = ['play_college', 'go_pro', 'improve_for_fun', 'make_team', 'stay_healthy'];
    if (endGoal !== undefined && !validEndGoals.includes(endGoal)) {
      return res.status(400).json({ error: `End goal must be one of: ${validEndGoals.join(', ')}` });
    }
    if (currentVelocity !== undefined && (typeof currentVelocity !== 'number' || currentVelocity < 30 || currentVelocity > 110)) {
      return res.status(400).json({ error: 'Current velocity must be between 30 and 110 MPH' });
    }
    if (targetVelocity !== undefined && (typeof targetVelocity !== 'number' || targetVelocity < 30 || targetVelocity > 110)) {
      return res.status(400).json({ error: 'Target velocity must be between 30 and 110 MPH' });
    }
    if (handedness !== undefined && !['R', 'L'].includes(handedness)) {
      return res.status(400).json({ error: 'Handedness must be "R" or "L"' });
    }

    // Check if email is already taken by another user
    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          id: { not: userId },
        },
      });

      if (existingUser) {
        return res.status(409).json({ error: 'Email already in use' });
      }
    }

    // Validate profilePicture URL if provided
    if (profilePicture !== undefined) {
      if (typeof profilePicture !== 'string' || profilePicture.length === 0) {
        return res.status(400).json({ error: 'Profile picture URL must be a non-empty string' });
      }
      // Basic URL validation
      try {
        new URL(profilePicture);
      } catch {
        return res.status(400).json({ error: 'Profile picture must be a valid URL' });
      }
    }

    // Update user
    const updateData: {
      name?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      dateOfBirth?: Date;
      age?: number;
      language?: string;
      role?: string;
      goals?: string[];
      profilePicture?: string;
      endGoal?: string;
      currentVelocity?: number;
      targetVelocity?: number;
      handedness?: string;
    } = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (parsedDateOfBirth !== undefined) updateData.dateOfBirth = parsedDateOfBirth;
    if (age !== undefined) updateData.age = age;
    if (language !== undefined) updateData.language = language;
    if (role !== undefined) updateData.role = role;
    if (goals !== undefined) updateData.goals = goals;
    if (profilePicture !== undefined) updateData.profilePicture = profilePicture;
    if (endGoal !== undefined) updateData.endGoal = endGoal;
    if (currentVelocity !== undefined) updateData.currentVelocity = currentVelocity;
    if (targetVelocity !== undefined) updateData.targetVelocity = targetVelocity;
    if (handedness !== undefined) updateData.handedness = handedness;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
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
        goals: true,
        handedness: true,
        endGoal: true,
        currentVelocity: true,
        targetVelocity: true,
        profilePicture: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Calculate age from dateOfBirth if available
    const responseUser = {
      ...updatedUser,
      calculatedAge: updatedUser.dateOfBirth
        ? Math.floor((Date.now() - new Date(updatedUser.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : updatedUser.age,
    };

    res.json(responseUser);
  } catch (error) {
    next(error);
  }
});

// Change password
router.post('/change-password', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user!.userId;

    // Validate input
    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(400).json({ error: 'Current password is required' });
    }
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'New password is required' });
    }

    // Validate password strength
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.errors[0] });
    }

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.password) {
      return res.status(400).json({ error: 'User has no password set' });
    }

    // Verify current password
    const valid = await verifyPassword(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Log password change
    await prisma.authAuditLog.create({
      data: {
        userId,
        action: 'password_change',
        ipAddress: getIpAddress(req),
      },
    }).catch(() => {
      // Don't fail if logging fails
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    next(error);
  }
});

// Request password reset
router.post('/forgot-password', authRateLimit, async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    // Always return success to prevent user enumeration
    await generatePasswordResetToken(email);

    res.json({
      message: 'If an account with that email exists, a password reset link has been sent',
    });
  } catch (error) {
    next(error);
  }
});

// Reset password with token
router.post('/reset-password', authRateLimit, async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Reset token is required' });
    }
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'New password is required' });
    }

    await resetPassword(token, newPassword);

    res.json({ message: 'Password has been reset successfully' });
  } catch (error: any) {
    if (error.message.includes('Invalid') || error.message.includes('expired')) {
      return res.status(400).json({ error: error.message });
    }
    if (error.message.includes('Password')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Verify email
router.post('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    await verifyEmail(token);

    res.json({ message: 'Email verified successfully' });
  } catch (error: any) {
    if (error.message.includes('Invalid') || error.message.includes('expired')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Resend email verification
router.post('/resend-verification', authRateLimit, async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    // Always return success to prevent user enumeration
    await resendEmailVerification(email);

    res.json({
      message: 'If an account with that email exists and is not verified, a verification email has been sent',
    });
  } catch (error) {
    next(error);
  }
});

// Get user sessions (active refresh tokens)
router.get('/sessions', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const sessions = await getUserSessions(req.user!.userId);
    res.json({ sessions });
  } catch (error) {
    next(error);
  }
});

// Revoke a specific session
router.delete('/sessions/:sessionId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { sessionId } = req.params;
    await revokeSession(req.user!.userId, sessionId);
    res.json({ message: 'Session revoked successfully' });
  } catch (error) {
    next(error);
  }
});

// OAuth sign-in endpoints
router.post('/oauth/google', authRateLimit, async (req, res, next) => {
  try {
    const { idToken } = req.body;
    const deviceId = req.headers['x-device-id'] as string | undefined;
    const ipAddress = getIpAddress(req);

    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'Google ID token is required' });
    }

    // Verify Google token
    const googleUser = await verifyGoogleToken(idToken);

    // Find or create user
    const user = await findOrCreateOAuthUser(
      'google',
      googleUser.providerId,
      googleUser.email,
      googleUser.name,
      googleUser.emailVerified,
      deviceId
    );

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshTokenValue = generateRefreshToken();
    const expiresAt = getRefreshTokenExpiry();

    await prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId: user.id,
        expiresAt,
        deviceId,
      },
    });

    // Log auth event
    await prisma.authAuditLog.create({
      data: {
        userId: user.id,
        action: 'login',
        ipAddress,
        metadata: { provider: 'google', deviceId },
      },
    }).catch(() => { }); // Don't fail if logging fails

    // Broadcast new user if this is a registration
    if (user.createdAt.getTime() > Date.now() - 5000) {
      broadcastUserCreated(user);
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: user.emailVerified,
      },
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: 15 * 60, // 15 minutes
    });
  } catch (error: any) {
    if (error.message.includes('not configured')) {
      return res.status(503).json({ error: 'Google Sign In is not configured' });
    }
    if (error.message.includes('verification failed')) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }
    next(error);
  }
});

router.post('/oauth/apple', authRateLimit, async (req, res, next) => {
  try {
    const { idToken, email, name } = req.body;
    const deviceId = req.headers['x-device-id'] as string | undefined;
    const ipAddress = getIpAddress(req);

    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'Apple ID token is required' });
    }

    // Verify Apple token
    const appleUser = await verifyAppleToken(idToken);

    // Apple only provides email/name on first sign-in, so use provided values or token values
    const userEmail = email || appleUser.email;
    const userName = name || appleUser.name || 'Apple User';

    if (!userEmail) {
      return res.status(400).json({ error: 'Email is required for Apple Sign In' });
    }

    // Find or create user
    const user = await findOrCreateOAuthUser(
      'apple',
      appleUser.providerId,
      userEmail,
      userName,
      appleUser.emailVerified || false,
      deviceId
    );

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshTokenValue = generateRefreshToken();
    const expiresAt = getRefreshTokenExpiry();

    await prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId: user.id,
        expiresAt,
        deviceId,
      },
    });

    // Log auth event
    await prisma.authAuditLog.create({
      data: {
        userId: user.id,
        action: 'login',
        ipAddress,
        metadata: { provider: 'apple', deviceId },
      },
    }).catch(() => { }); // Don't fail if logging fails

    // Broadcast new user if this is a registration
    if (user.createdAt.getTime() > Date.now() - 5000) {
      broadcastUserCreated(user);
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: user.emailVerified,
      },
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: 15 * 60, // 15 minutes
    });
  } catch (error: any) {
    if (error.message.includes('not configured')) {
      return res.status(503).json({ error: 'Apple Sign In is not configured' });
    }
    if (error.message.includes('verification failed')) {
      return res.status(401).json({ error: 'Invalid Apple token' });
    }
    next(error);
  }
});

// Search users for chat (authenticated)
router.get('/users/search', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { q, limit = '20' } = req.query;
    const userId = req.user!.userId;

    if (!q || typeof q !== 'string' || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const maxLimit = Math.min(parseInt(limit as string) || 20, 50);

    const users = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: userId } }, // Exclude current user
          {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        profilePicture: true,
      },
      take: maxLimit,
      orderBy: { name: 'asc' },
    });

    res.json({ users });
  } catch (error) {
    next(error);
  }
});

export default router;
