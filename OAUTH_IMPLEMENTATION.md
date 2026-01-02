# OAuth Implementation Guide (Apple & Google Sign In)

This guide covers implementing Apple Sign In and Google Sign In for your mobile app.

## Overview

The implementation consists of:
1. **Mobile App**: OAuth sign-in flows using Expo libraries
2. **Backend API**: OAuth token verification and user creation/authentication
3. **Database**: Track OAuth provider and provider ID for users

## Architecture

### Flow
1. User taps "Sign in with Apple/Google" in the app
2. Native OAuth flow completes, returning an ID token
3. App sends ID token to your backend `/auth/oauth` endpoint
4. Backend verifies the token with Apple/Google
5. Backend creates or finds user, returns JWT tokens
6. App stores tokens and logs user in

## Step 1: Install Mobile Dependencies

```bash
cd apps/mobile
npx expo install expo-auth-session expo-crypto expo-apple-authentication
```

**Note**: `expo-apple-authentication` requires a native build (not Expo Go). Use EAS Build for production.

## Step 2: Backend Setup

### Environment Variables

Add to `apps/api/.env`:

```env
# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret  # Only needed if using server-side verification

# Apple OAuth
APPLE_CLIENT_ID=your.app.bundle.id
APPLE_TEAM_ID=your-team-id
APPLE_KEY_ID=your-key-id
APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
```

### Install Backend Dependencies

```bash
cd apps/api
npm install jsonwebtoken google-auth-library
```

## Step 3: Database Schema Updates

The schema already supports OAuth users, but we need to track the OAuth provider ID. We'll add fields to the User model.

## Step 4: Implementation Steps

1. **Backend OAuth endpoints** (handle token verification)
2. **Mobile OAuth services** (handle sign-in flows)
3. **Update Login/Register screens** (add OAuth buttons)
4. **Testing**

## Security Considerations

- Verify tokens server-side (never trust client tokens alone)
- Use secure token storage on mobile
- Handle token expiration gracefully
- Support account linking (if user signs up with email, later links Apple/Google)

