# Professional Auth Service Documentation

## Overview

A comprehensive authentication service has been implemented with enterprise-grade security features including password strength validation, account lockout, email verification, password reset, session management, and security audit logging.

## Architecture

### Service Layer (`src/services/authService.ts`)

The authentication logic is now separated into a dedicated service layer, providing:

- **Separation of Concerns**: Business logic separated from route handlers
- **Reusability**: Service functions can be used across different contexts
- **Testability**: Easy to unit test business logic independently
- **Maintainability**: Centralized authentication logic

### Email Service (`src/services/emailService.ts`)

A flexible email service that can be extended to support multiple providers (SendGrid, AWS SES, etc.). Currently logs emails in development mode.

## Features

### 1. Password Strength Validation

- Minimum 8 characters
- Maximum 128 characters
- At least one lowercase letter
- At least one uppercase letter
- At least one number
- Checks against common weak passwords

### 2. Account Lockout Protection

- Locks account after 5 failed login attempts
- 30-minute lockout duration
- Automatic unlock after lockout period expires
- Failed attempts are tracked and logged

### 3. Email Verification

- Email verification token generated on registration
- 24-hour expiration for verification tokens
- Resend verification email functionality
- Email verified status tracked in database

### 4. Password Reset Flow

- Secure token-based password reset
- 1-hour expiration for reset tokens
- All existing sessions revoked on password reset
- Password reset requests logged

### 5. Session Management

- View all active sessions for a user
- Revoke specific sessions
- Logout all devices
- Device tracking support

### 6. Security Audit Logging

All authentication events are logged with:
- User ID
- Action type (login, logout, password_change, etc.)
- IP address
- User agent
- Timestamp
- Additional metadata

**Logged Actions:**
- `register` - User registration
- `login` - Successful login
- `logout` - User logout
- `logout_all` - Logout from all devices
- `failed_login` - Failed login attempt
- `account_locked` - Account locked due to failed attempts
- `password_change` - Password changed
- `password_reset` - Password reset via token
- `email_verification` - Email verified

## Database Schema Changes

### New User Fields

```prisma
emailVerified           Boolean?  @default(false)
emailVerificationToken  String?
emailVerificationExpiry DateTime?
passwordResetToken      String?
passwordResetExpiry     DateTime?
failedLoginAttempts     Int       @default(0)
lockedUntil             DateTime?
```

### New Model: AuthAuditLog

```prisma
model AuthAuditLog {
  id        String   @id @default(cuid())
  userId    String
  action    String   // login, logout, password_change, etc.
  ipAddress String?
  userAgent String?
  metadata  Json?
  createdAt DateTime @default(now())
}
```

## API Endpoints

### Existing (Updated)
- `POST /auth/register` - Register new user (now includes email verification)
- `POST /auth/login` - Login (now includes account lockout protection)
- `POST /auth/refresh` - Refresh access token
- `POST /auth/logout` - Logout (now includes audit logging)
- `POST /auth/logout-all` - Logout all devices (now includes audit logging)
- `GET /auth/me` - Get current user (now includes emailVerified status)
- `PATCH /auth/profile` - Update profile (now includes emailVerified status)
- `POST /auth/change-password` - Change password (now includes password strength validation)

### New Endpoints

#### Password Reset
- `POST /auth/forgot-password` - Request password reset
  - Body: `{ email: string }`
  - Always returns success (prevents user enumeration)

- `POST /auth/reset-password` - Reset password with token
  - Body: `{ token: string, newPassword: string }`
  - Validates password strength
  - Revokes all existing sessions

#### Email Verification
- `POST /auth/verify-email` - Verify email address
  - Body: `{ token: string }`

- `POST /auth/resend-verification` - Resend verification email
  - Body: `{ email: string }`
  - Always returns success (prevents user enumeration)

#### Session Management
- `GET /auth/sessions` - Get all active sessions
  - Returns: `{ sessions: Array<{ id, deviceId, createdAt, expiresAt }> }`

- `DELETE /auth/sessions/:sessionId` - Revoke a specific session
  - Returns: `{ message: "Session revoked successfully" }`

## Setup Instructions

### 1. Run Database Migration

The schema has been updated with new fields. You need to create and run a migration:

```bash
cd apps/api

# Generate Prisma client with new schema
npm run db:generate

# Create migration
npm run db:migrate -- --name add_auth_security_features

# Or if using db:push (development only)
npm run db:push
```

### 2. Configure Email Service

The email service currently logs emails in development. To enable actual email sending in production:

1. **Option A: SendGrid** (Recommended)
   ```bash
   npm install @sendgrid/mail
   ```

   Update `src/services/emailService.ts`:
   ```typescript
   import sgMail from '@sendgrid/mail';
   sgMail.setApiKey(process.env.SENDGRID_API_KEY);
   await sgMail.send(options);
   ```

2. **Option B: AWS SES**
   ```bash
   npm install @aws-sdk/client-ses
   ```

3. **Option C: Nodemailer** (for SMTP)
   ```bash
   npm install nodemailer
   ```

Set environment variables:
- `SENDGRID_API_KEY` (for SendGrid)
- `FRONTEND_URL` - Base URL for email links (e.g., `https://app.example.com`)

### 3. Environment Variables

Add these to your `.env` file:

```env
# Email configuration
FRONTEND_URL=http://localhost:3000  # For development
# SENDGRID_API_KEY=your-key-here     # When using SendGrid

# Existing JWT_SECRET is still required
JWT_SECRET=your-secret-here
```

## Security Best Practices Implemented

1. **Password Security**
   - Strong password requirements
   - bcrypt hashing (12 rounds)
   - Password strength validation

2. **Account Protection**
   - Account lockout after failed attempts
   - Rate limiting on auth endpoints
   - Protection against user enumeration (same error messages)

3. **Token Security**
   - Short-lived access tokens (15 minutes)
   - Secure refresh tokens (cryptographically random)
   - Token expiration and revocation
   - One-time use tokens for password reset

4. **Audit Trail**
   - Comprehensive logging of all auth events
   - IP address tracking
   - Metadata storage for investigation

5. **Email Security**
   - Time-limited tokens
   - Secure token generation
   - Email verification requirement

## Testing

To test the new features:

```bash
# Run existing tests
npm test

# Test password strength validation
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"weak","name":"Test"}'

# Test password reset flow
curl -X POST http://localhost:4000/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# Test session management
curl -X GET http://localhost:4000/auth/sessions \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Migration Notes

### Breaking Changes

None! All existing endpoints remain backward compatible. The new fields have default values, so existing users will:
- Have `emailVerified: false` by default
- Have `failedLoginAttempts: 0` by default
- Not have account lockout applied retroactively

### Backward Compatibility

- Existing refresh tokens continue to work
- Users without email verification can still log in (email verification is optional enforcement)
- Existing password hashes remain valid

## Future Enhancements

Potential future additions:
- [ ] Two-Factor Authentication (2FA)
- [ ] OAuth/Social login (Google, Apple, etc.)
- [ ] Biometric authentication
- [ ] Password expiration policies
- [ ] Advanced session management (device fingerprinting)
- [ ] Security notifications (email alerts for suspicious activity)
- [ ] IP allowlisting/blocklisting
- [ ] CAPTCHA integration for registration/login

## Troubleshooting

### Email not sending

- Check email service configuration
- Verify `FRONTEND_URL` is set correctly
- Check email provider API keys
- Review console logs (emails are logged in development)

### Account locked

- Wait 30 minutes for automatic unlock
- Or manually reset in database: `UPDATE "User" SET "lockedUntil" = NULL, "failedLoginAttempts" = 0 WHERE email = 'user@example.com';`

### Migration errors

- Ensure database is backed up before migration
- Review migration file in `prisma/migrations/`
- If issues, you can use `db:push` for development (not recommended for production)

## Support

For issues or questions, refer to:
- Code comments in `src/services/authService.ts`
- Prisma schema documentation
- Security best practices documentation

