# Test Template Reference Guide

This file serves as a template and reference for creating tests in this codebase. When asked to create tests, use these patterns.

## Test Structure

### Basic Test File Structure

```typescript
import { Request, Response, NextFunction } from 'express';
import { functionToTest } from './module';

describe('Module Name', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    // Set up test environment
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
    
    // Initialize mocks
    mockRequest = {
      headers: {},
      body: {},
      params: {},
      query: {},
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
  });

  describe('Feature Name', () => {
    it('should handle success case', () => {
      // Arrange
      mockRequest.body = { data: 'test' };

      // Act
      functionToTest(mockRequest as Request, mockResponse as Response, nextFunction);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(nextFunction).toHaveBeenCalled();
    });

    it('should handle error case', () => {
      // Arrange
      mockRequest.body = { invalid: 'data' };

      // Act
      functionToTest(mockRequest as Request, mockResponse as Response, nextFunction);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Expected error message' });
    });
  });
});
```

## Middleware Testing Pattern

### Authentication Middleware Test

```typescript
import { authenticate, requireAdmin, AuthRequest } from './auth';
import { generateAccessToken, verifyToken } from '../lib/jwt';

describe('Authentication Middleware', () => {
  let mockRequest: Partial<AuthRequest>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-key';
    mockRequest = { headers: {} };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
  });

  describe('authenticate', () => {
    it('should allow valid token', () => {
      const token = generateAccessToken({
        id: 'user-id',
        email: 'user@test.com',
        role: 'user',
      });

      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      authenticate(mockRequest as AuthRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockRequest.user).toBeDefined();
    });

    it('should reject missing token', () => {
      mockRequest.headers = {};

      authenticate(mockRequest as AuthRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'No token provided' });
    });
  });

  describe('requireAdmin', () => {
    it('should allow admin role', () => {
      mockRequest.user = {
        userId: 'admin-id',
        email: 'admin@test.com',
        role: 'admin',
      };

      requireAdmin(mockRequest as AuthRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should allow nathan role', () => {
      mockRequest.user = {
        userId: 'nathan-id',
        email: 'nathan@test.com',
        role: 'nathan',
      };

      requireAdmin(mockRequest as AuthRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should deny user role', () => {
      mockRequest.user = {
        userId: 'user-id',
        email: 'user@test.com',
        role: 'user',
      };

      requireAdmin(mockRequest as AuthRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Admin access required' });
    });
  });
});
```

## Route/Endpoint Testing Pattern

### Using Supertest (for full integration tests)

```typescript
import request from 'supertest';
import express from 'express';
import { generateAccessToken } from '../lib/jwt';
import routes from './routes';

const app = express();
app.use(express.json());
app.use('/api', routes);

describe('API Routes', () => {
  describe('GET /api/endpoint', () => {
    it('should return data for authenticated user', async () => {
      const token = generateAccessToken({
        id: 'user-id',
        email: 'user@test.com',
        role: 'user',
      });

      const response = await request(app)
        .get('/api/endpoint')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
    });

    it('should return 401 for unauthenticated request', async () => {
      const response = await request(app).get('/api/endpoint');

      expect(response.status).toBe(401);
    });
  });
});
```

## Database Testing Pattern

### Mocking Prisma (for unit tests)

```typescript
import prisma from '../lib/prisma';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

describe('User Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create user', async () => {
    const mockUser = {
      id: 'user-id',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
    };

    (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);

    const result = await createUser({
      email: 'test@example.com',
      name: 'Test User',
      password: 'password123',
    });

    expect(prisma.user.create).toHaveBeenCalled();
    expect(result).toEqual(mockUser);
  });
});
```

## Test File Naming Conventions

- Unit tests: `*.test.ts` (same directory or `__tests__` subdirectory)
- Integration tests: `*.integration.test.ts` or in `__tests__/integration/`
- Test files should be next to the file they test, or in a `__tests__` folder

Examples:
- `src/middleware/auth.ts` → `src/middleware/auth.test.ts`
- `src/routes/admin.ts` → `src/routes/__tests__/admin.test.ts`

## Common Test Patterns

### Testing Error Handling

```typescript
it('should handle database errors', async () => {
  (prisma.user.findUnique as jest.Mock).mockRejectedValue(
    new Error('Database connection failed')
  );

  await expect(getUser('user-id')).rejects.toThrow('Database connection failed');
});
```

### Testing Validation

```typescript
it('should reject invalid input', async () => {
  const invalidData = { email: 'not-an-email' };

  const response = await request(app)
    .post('/api/users')
    .send(invalidData)
    .set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(400);
  expect(response.body.error).toContain('validation');
});
```

### Testing Authorization

```typescript
it('should deny access to unauthorized users', async () => {
  const userToken = generateAccessToken({
    id: 'user-id',
    email: 'user@test.com',
    role: 'user',
  });

  const response = await request(app)
    .get('/api/admin/users')
    .set('Authorization', `Bearer ${userToken}`);

  expect(response.status).toBe(403);
  expect(response.body.error).toBe('Admin access required');
});
```

## Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode (re-run on file changes)
npm run test:coverage # Generate coverage report
npm test -- auth      # Run tests matching pattern
```

## Test Checklist

When creating tests, ensure:
- [ ] Tests cover happy path (success cases)
- [ ] Tests cover error cases (validation, authorization, etc.)
- [ ] Tests cover edge cases (empty input, null values, etc.)
- [ ] Tests are isolated (use `beforeEach` to reset state)
- [ ] Tests have descriptive names (should... when...)
- [ ] Mocks are properly cleaned up
- [ ] Environment variables are set for test environment
- [ ] Assertions are specific and meaningful

## Important Notes

1. **Always test both admin and nathan roles** when testing admin endpoints
2. **Always test that user role is rejected** for admin-only endpoints
3. **Use real JWT tokens** in integration tests (generateAccessToken + verifyToken)
4. **Mock Prisma** for unit tests to avoid database dependencies
5. **Set JWT_SECRET** in beforeEach to ensure consistent test environment
6. **Test error responses** include proper status codes and error messages


