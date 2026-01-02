import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import {
  generateAccessToken,
  generateRefreshToken,
  getRefreshTokenExpiry,
  JwtPayload,
} from '../lib/jwt';
import { RegisterSchema, LoginSchema } from '../lib/shared';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
} from './emailService';

// Password hashing configuration
const BCRYPT_ROUNDS = 12;

// Account lockout configuration
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;

// Token expiration times
const PASSWORD_RESET_TOKEN_EXPIRY_HOURS = 1;
const EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS = 24;

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    profilePicture?: string | null;
  };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserWithTokens {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    emailVerified: boolean;
  };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Create authentication response with tokens
 */
async function createAuthResponse(
  user: { id: string; email: string; name: string; role: string; profilePicture?: string | null },
  deviceId?: string
): Promise<AuthResponse> {
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

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      profilePicture: user.profilePicture || null,
    },
    accessToken,
    refreshToken: refreshTokenValue,
    expiresIn: 15 * 60, // 15 minutes in seconds
  };
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Check if account is locked due to failed login attempts
 */
async function isAccountLocked(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, lockedUntil: true },
  });

  if (!user || !user.lockedUntil) {
    return false;
  }

  if (new Date() < user.lockedUntil) {
    return true;
  }

  // Lock has expired, unlock the account
  await prisma.user.update({
    where: { id: userId },
    data: {
      lockedUntil: null,
      failedLoginAttempts: 0,
    },
  });

  return false;
}

/**
 * Log authentication event to audit log
 */
async function logAuthEvent(
  userId: string,
  action: string,
  options?: {
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
  }
): Promise<void> {
  try {
    await prisma.authAuditLog.create({
      data: {
        userId,
        action,
        ipAddress: options?.ipAddress,
        userAgent: options?.userAgent,
        metadata: options?.metadata ? JSON.parse(JSON.stringify(options.metadata)) : null,
      },
    });
  } catch (error) {
    console.error('Failed to log auth event:', error);
    // Don't fail auth operations if logging fails
  }
}

/**
 * Record a failed login attempt
 */
async function recordFailedLoginAttempt(
  userId: string,
  ipAddress?: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, failedLoginAttempts: true },
  });

  if (!user) return;

  const newAttempts = (user.failedLoginAttempts || 0) + 1;

  // Log failed login attempt
  await logAuthEvent(userId, 'failed_login', { ipAddress, metadata: {} });

  if (newAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
    // Lock the account
    const lockedUntil = new Date();
    lockedUntil.setMinutes(
      lockedUntil.getMinutes() + LOCKOUT_DURATION_MINUTES
    );

    await prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: newAttempts,
        lockedUntil,
      },
    });

    // Log account lockout
    await logAuthEvent(userId, 'account_locked', {
      metadata: {
        attempts: newAttempts,
        lockedUntil: lockedUntil.toISOString(),
      },
    });
  } else {
    await prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: newAttempts,
      },
    });
  }
}

/**
 * Clear failed login attempts (on successful login)
 */
async function clearFailedLoginAttempts(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
}

/**
 * Validate password strength
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (password.length > 128) {
    errors.push('Password must be less than 128 characters');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  // Check for common weak passwords
  const commonPasswords = [
    'password',
    'password123',
    '12345678',
    'qwerty',
    'abc123',
  ];
  if (commonPasswords.some((common) => password.toLowerCase().includes(common))) {
    errors.push('Password is too common. Please choose a stronger password');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Register a new user
 */
export async function registerUser(
  data: { email: string; password: string; name: string },
  deviceId?: string
): Promise<AuthResponse> {
  // Validate input
  const validatedData = RegisterSchema.parse(data);

  // Check if user exists
  const existing = await prisma.user.findUnique({
    where: { email: validatedData.email },
  });

  if (existing) {
    throw new Error('Email already registered');
  }

  // Validate password strength
  const passwordValidation = validatePasswordStrength(validatedData.password);
  if (!passwordValidation.valid) {
    throw new Error(passwordValidation.errors[0]);
  }

  // Hash password
  const hashedPassword = await hashPassword(validatedData.password);

  // Generate email verification token
  const emailVerificationToken = crypto.randomBytes(32).toString('hex');
  const emailVerificationExpiry = new Date();
  emailVerificationExpiry.setHours(
    emailVerificationExpiry.getHours() + EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS
  );

  // Create user
  const user = await prisma.user.create({
    data: {
      email: validatedData.email,
      password: hashedPassword,
      name: validatedData.name,
      emailVerificationToken,
      emailVerificationExpiry,
      emailVerified: false,
    },
  });

  // Send verification email
  await sendVerificationEmail(user.email, emailVerificationToken).catch(
    (error) => {
      console.error('Failed to send verification email:', error);
      // Don't fail registration if email fails
    }
  );

  // Log registration
  await logAuthEvent(user.id, 'register', { metadata: {} });

  return createAuthResponse(user, deviceId);
}

/**
 * Login a user
 */
export async function loginUser(
  data: { email: string; password: string },
  deviceId?: string,
  ipAddress?: string
): Promise<AuthResponse> {
  // Validate input
  const validatedData = LoginSchema.parse(data);

  // Find user
  const user = await prisma.user.findUnique({
    where: { email: validatedData.email },
  });

  // Always return same error message to prevent user enumeration
  if (!user) {
    throw new Error('Invalid credentials');
  }

  // Check if user has a password set
  if (!user.password) {
    throw new Error('Invalid credentials');
  }

  // Check if account is locked
  if (await isAccountLocked(user.id)) {
    throw new Error('Account is temporarily locked due to multiple failed login attempts');
  }

  // Check password
  const valid = await verifyPassword(validatedData.password, user.password!);
  if (!valid) {
    await recordFailedLoginAttempt(user.id, ipAddress);
    throw new Error('Invalid credentials');
  }

  // Clear failed login attempts on successful login
  await clearFailedLoginAttempts(user.id);

  // Log successful login
  await logAuthEvent(user.id, 'login', {
    ipAddress,
    metadata: deviceId ? { deviceId } : {},
  });

  return createAuthResponse(user, deviceId);
}

/**
 * Refresh access token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  // Find the refresh token
  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });

  if (!storedToken) {
    throw new Error('Invalid refresh token');
  }

  // Check if revoked or expired
  if (storedToken.isRevoked) {
    throw new Error('Token has been revoked');
  }

  if (new Date() > storedToken.expiresAt) {
    // Clean up expired token
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });
    throw new Error('Refresh token expired');
  }

  // Generate new access token
  const accessToken = generateAccessToken(storedToken.user);

  return {
    accessToken,
    expiresIn: 15 * 60, // 15 minutes
  };
}

/**
 * Logout - revoke refresh token
 */
export async function logoutUser(
  userId: string,
  refreshToken?: string,
  ipAddress?: string
): Promise<void> {
  if (refreshToken) {
    // Revoke the specific refresh token
    await prisma.refreshToken.updateMany({
      where: {
        token: refreshToken,
        userId,
      },
      data: { isRevoked: true },
    });
  }

  // Log logout
  await logAuthEvent(userId, 'logout', { ipAddress, metadata: {} });
}

/**
 * Logout all devices - revoke all refresh tokens for user
 */
export async function logoutAllDevices(userId: string, ipAddress?: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId },
    data: { isRevoked: true },
  });

  // Log logout all
  await logAuthEvent(userId, 'logout_all', { ipAddress, metadata: {} });
}

/**
 * Get user sessions (active refresh tokens)
 */
export async function getUserSessions(userId: string) {
  const sessions = await prisma.refreshToken.findMany({
    where: {
      userId,
      isRevoked: false,
      expiresAt: {
        gt: new Date(),
      },
    },
    select: {
      id: true,
      deviceId: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return sessions;
}

/**
 * Revoke a specific session
 */
export async function revokeSession(
  userId: string,
  sessionId: string
): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: {
      id: sessionId,
      userId,
    },
    data: { isRevoked: true },
  });
}

/**
 * Generate password reset token
 */
export async function generatePasswordResetToken(
  email: string
): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  // Always return success to prevent user enumeration
  if (!user) {
    // Return a dummy token to prevent timing attacks
    return crypto.randomBytes(32).toString('hex');
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetExpiry = new Date();
  resetExpiry.setHours(
    resetExpiry.getHours() + PASSWORD_RESET_TOKEN_EXPIRY_HOURS
  );

  // Store reset token
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: resetToken,
      passwordResetExpiry: resetExpiry,
    },
  });

  // Send password reset email
  await sendPasswordResetEmail(user.email, resetToken).catch((error) => {
    console.error('Failed to send password reset email:', error);
    // Don't fail if email fails - still return token for API responses
  });

  return resetToken;
}

/**
 * Reset password using reset token
 */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<void> {
  // Find user with valid reset token
  const user = await prisma.user.findFirst({
    where: {
      passwordResetToken: token,
      passwordResetExpiry: {
        gt: new Date(),
      },
    },
  });

  if (!user) {
    throw new Error('Invalid or expired reset token');
  }

  // Validate password strength
  const passwordValidation = validatePasswordStrength(newPassword);
  if (!passwordValidation.valid) {
    throw new Error(passwordValidation.errors[0]);
  }

  // Hash new password
  const hashedPassword = await hashPassword(newPassword);

  // Update password and clear reset token
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpiry: null,
      failedLoginAttempts: 0, // Clear failed attempts on password reset
      lockedUntil: null,
    },
  });

  // Revoke all existing refresh tokens (force re-login)
  await logoutAllDevices(user.id);

  // Log password reset
  await logAuthEvent(user.id, 'password_reset', { metadata: {} });
}

/**
 * Verify email address
 */
export async function verifyEmail(token: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: {
      emailVerificationToken: token,
      emailVerificationExpiry: {
        gt: new Date(),
      },
    },
  });

  if (!user) {
    throw new Error('Invalid or expired verification token');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiry: null,
    },
  });

  // Log email verification
  await logAuthEvent(user.id, 'email_verification', { metadata: {} });
}

/**
 * Resend email verification
 */
export async function resendEmailVerification(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  // Don't reveal if user exists
  if (!user || user.emailVerified) {
    return;
  }

  // Generate new verification token
  const emailVerificationToken = crypto.randomBytes(32).toString('hex');
  const emailVerificationExpiry = new Date();
  emailVerificationExpiry.setHours(
    emailVerificationExpiry.getHours() + EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS
  );

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationToken,
      emailVerificationExpiry,
    },
  });

  // Send verification email
  await sendVerificationEmail(user.email, emailVerificationToken).catch(
    (error) => {
      console.error('Failed to send verification email:', error);
      // Don't fail if email fails
    }
  );
}

