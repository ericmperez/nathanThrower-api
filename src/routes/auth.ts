import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { RegisterSchema, LoginSchema } from '../lib/shared';
import prisma from '../lib/prisma';
import {
  generateAccessToken,
  generateRefreshToken,
  getRefreshTokenExpiry,
  verifyToken
} from '../lib/jwt';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authRateLimit } from '../middleware/rateLimit';

const router = Router();

// Helper to create auth response with tokens
async function createAuthResponse(user: { id: string; email: string; name: string; role: string }, deviceId?: string) {
  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshTokenValue = generateRefreshToken();
  const expiresAt = getRefreshTokenExpiry();

  // Store refresh token in database
  await prisma.refreshToken.create({
    data: {
      token: refreshTokenValue,
      userId: user.id,
      expiresAt,
      deviceId,
    },
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    accessToken,
    refreshToken: refreshTokenValue,
    expiresIn: 15 * 60, // 15 minutes in seconds
  };
}

// Register
router.post('/register', authRateLimit, async (req, res, next) => {
  try {
    const data = RegisterSchema.parse(req.body);
    const deviceId = req.headers['x-device-id'] as string | undefined;

    // Check if user exists
    const existing = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 12); // Increased from 10 to 12 rounds

    // Create user
    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        name: data.name,
      },
    });

    // Generate auth response
    const authResponse = await createAuthResponse(user, deviceId);
    res.status(201).json(authResponse);
  } catch (error) {
    next(error);
  }
});

// Login
router.post('/login', authRateLimit, async (req, res, next) => {
  try {
    const data = LoginSchema.parse(req.body);
    const deviceId = req.headers['x-device-id'] as string | undefined;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user) {
      // Use same message to prevent user enumeration
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const valid = await bcrypt.compare(data.password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate auth response
    const authResponse = await createAuthResponse(user, deviceId);
    res.json(authResponse);
  } catch (error) {
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

    // Find the refresh token
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!storedToken) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Check if revoked or expired
    if (storedToken.isRevoked) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    if (new Date() > storedToken.expiresAt) {
      // Clean up expired token
      await prisma.refreshToken.delete({ where: { id: storedToken.id } });
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    // Generate new access token (refresh token remains the same for simplicity)
    const accessToken = generateAccessToken(storedToken.user);

    res.json({
      accessToken,
      expiresIn: 15 * 60, // 15 minutes
    });
  } catch (error) {
    next(error);
  }
});

// Logout - revoke the refresh token
router.post('/logout', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      // Revoke the specific refresh token
      await prisma.refreshToken.updateMany({
        where: {
          token: refreshToken,
          userId: req.user!.userId,
        },
        data: { isRevoked: true },
      });
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
});

// Logout all devices - revoke all refresh tokens for the user
router.post('/logout-all', authenticate, async (req: AuthRequest, res, next) => {
  try {
    // Revoke all refresh tokens for this user
    await prisma.refreshToken.updateMany({
      where: { userId: req.user!.userId },
      data: { isRevoked: true },
    });

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
        role: true,
        createdAt: true,
        updatedAt: true,
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

// Update profile
router.patch('/profile', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { name, email } = req.body;
    const userId = req.user!.userId;

    // Validate input
    if (name !== undefined && (typeof name !== 'string' || name.length < 2)) {
      return res.status(400).json({ error: 'Name must be at least 2 characters' });
    }
    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
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

    // Update user
    const updateData: { name?: string; email?: string } = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(updatedUser);
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
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
