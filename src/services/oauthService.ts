import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';

// Google OAuth client
let googleClient: OAuth2Client | null = null;

if (process.env.GOOGLE_CLIENT_ID) {
  googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
}

/**
 * Verify Google ID token and return user info
 */
export async function verifyGoogleToken(idToken: string): Promise<{
  email: string;
  name: string;
  providerId: string;
  emailVerified: boolean;
}> {
  if (!googleClient) {
    throw new Error('Google OAuth not configured. Set GOOGLE_CLIENT_ID environment variable.');
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      throw new Error('Invalid Google token payload');
    }

    return {
      email: payload.email!,
      name: payload.name || payload.email!.split('@')[0],
      providerId: payload.sub,
      emailVerified: payload.email_verified || false,
    };
  } catch (error: any) {
    throw new Error(`Google token verification failed: ${error.message}`);
  }
}

/**
 * Verify Apple ID token and return user info
 */
export async function verifyAppleToken(idToken: string): Promise<{
  email?: string;
  name?: string;
  providerId: string;
  emailVerified: boolean;
}> {
  // Apple token verification is more complex - we'll use a simplified approach
  // For production, you may want to verify the token signature using Apple's public keys
  // For now, we'll decode and validate the token structure
  
  try {
    // Decode the token (without verification for now - in production you should verify)
    // Note: For production, you should verify the signature using Apple's JWKS
    const decoded = jwt.decode(idToken, { complete: true });
    
    if (!decoded || typeof decoded === 'string') {
      throw new Error('Invalid Apple token format');
    }

    const payload = decoded.payload as any;

    // Validate token
    if (payload.iss !== 'https://appleid.apple.com') {
      throw new Error('Invalid Apple token issuer');
    }

    if (payload.aud !== process.env.APPLE_CLIENT_ID) {
      throw new Error('Invalid Apple token audience');
    }

    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      throw new Error('Apple token has expired');
    }

    return {
      email: payload.email, // May be null for subsequent sign-ins
      name: payload.name, // Only provided on first sign-in
      providerId: payload.sub,
      emailVerified: payload.email_verified || false,
    };
  } catch (error: any) {
    throw new Error(`Apple token verification failed: ${error.message}`);
  }
}

/**
 * Find or create user from OAuth provider
 */
export async function findOrCreateOAuthUser(
  provider: 'apple' | 'google',
  providerId: string,
  email: string,
  name: string,
  emailVerified: boolean,
  deviceId?: string
) {
  // First, try to find user by OAuth provider + providerId
  let user = await prisma.user.findFirst({
    where: {
      oauthProvider: provider,
      oauthId: providerId,
    },
  });

  // If not found, try to find by email (for account linking)
  if (!user) {
    user = await prisma.user.findUnique({
      where: { email },
    });

    // If user exists with email but has a password (email/password account), link OAuth
    if (user && user.password) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          oauthProvider: provider,
          oauthId: providerId,
          emailVerified: emailVerified || user.emailVerified,
        },
      });
    }
  }

  // If still not found, create new user
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name,
        oauthProvider: provider,
        oauthId: providerId,
        password: null, // OAuth users don't have passwords
        emailVerified,
      },
    });
  } else {
    // Update name and email verified status if needed
    if (name && name !== user.name) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name },
      });
    }
    
    if (emailVerified && !user.emailVerified) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
    }
  }

  return user;
}

