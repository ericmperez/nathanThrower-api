import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Validate JWT_SECRET in production
const JWT_SECRET = process.env.JWT_SECRET;
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && (!JWT_SECRET || JWT_SECRET.length < 32)) {
  throw new Error(
    'JWT_SECRET must be set to a strong random string (32+ characters) in production. ' +
    'Generate one with: openssl rand -base64 32'
  );
}

if (!JWT_SECRET) {
  if (isProduction) {
    throw new Error('JWT_SECRET must be set in production');
  }
  console.warn('⚠️  WARNING: JWT_SECRET not set. Set JWT_SECRET environment variable before deploying to production.');
}

const SECRET = JWT_SECRET || 'dev-only-secret-do-not-use-in-production';
const ACCESS_TOKEN_EXPIRY = '15m'; // Short-lived access token
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expires
}

/**
 * Generate a short-lived access token (15 minutes)
 */
export function generateAccessToken(user: { id: string; email: string; role: string }): string {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role } as JwtPayload,
    SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

/**
 * Generate a cryptographically secure refresh token
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Get refresh token expiration date
 */
export function getRefreshTokenExpiry(): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
  return expiry;
}

/**
 * Verify and decode an access token
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as JwtPayload;
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use generateAccessToken instead
 */
export function generateToken(user: { id: string; email: string; role: string }): string {
  return generateAccessToken(user);
}
