# Testing Guide

This document provides guidelines for writing and running tests in the API codebase.

## Quick Start

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- auth.test

# Run tests matching pattern
npm test -- --testNamePattern="admin"
```

## Test Structure

### File Organization

- Test files should be named `*.test.ts` or `*.spec.ts`
- Place test files next to the code they test, or in a `__tests__` subdirectory
- Example: `src/middleware/auth.ts` → `src/middleware/auth.test.ts`

### Test Template

See `src/__tests__/.test-template.ts` for a complete template you can copy.

## Key Testing Patterns

### 1. Middleware Testing

```typescript
import { requireAdmin, AuthRequest } from './auth';

describe('requireAdmin', () => {
  it('should allow admin and nathan roles', () => {
    // Test both admin and nathan
  });
  
  it('should deny user role', () => {
    // Test regular users are rejected
  });
});
```

### 2. Authentication Testing

Always test:
- ✅ Valid token
- ✅ Invalid/missing token
- ✅ Expired token
- ✅ Admin role access
- ✅ Nathan role access
- ✅ User role denial

### 3. Admin Endpoint Testing

**IMPORTANT**: Admin endpoints must allow both `admin` AND `nathan` roles.

```typescript
it('should allow admin role', () => {
  mockRequest.user = { userId: 'id', email: 'admin@test.com', role: 'admin' };
  // Should succeed
});

it('should allow nathan role', () => {
  mockRequest.user = { userId: 'id', email: 'nathan@test.com', role: 'nathan' };
  // Should succeed
});

it('should deny user role', () => {
  mockRequest.user = { userId: 'id', email: 'user@test.com', role: 'user' };
  // Should return 403
});
```

### 4. Database Testing

For unit tests, mock Prisma:

```typescript
jest.mock('../lib/prisma', () => ({
  default: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));
```

## Test Checklist

Before submitting tests, verify:

- [ ] Tests cover success cases
- [ ] Tests cover error cases
- [ ] Tests cover edge cases
- [ ] Admin endpoints test both `admin` and `nathan` roles
- [ ] Admin endpoints test that `user` role is denied
- [ ] Tests are isolated (use beforeEach/afterEach)
- [ ] Mocks are cleaned up
- [ ] Environment variables are set
- [ ] Test names are descriptive

## Common Mistakes to Avoid

1. ❌ Testing only `admin` role - must test `nathan` too
2. ❌ Forgetting to test that `user` role is denied
3. ❌ Not cleaning up mocks between tests
4. ❌ Not setting JWT_SECRET in test environment
5. ❌ Testing implementation details instead of behavior

## Reference Files

- `TEST_TEMPLATE.md` - Detailed template with examples
- `src/__tests__/.test-template.ts` - Code template to copy
- `src/middleware/auth.test.ts` - Example of middleware tests



