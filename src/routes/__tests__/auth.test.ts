import request from 'supertest';
import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../../lib/prisma';
import { broadcastUserCreated } from '../../lib/websocket';
import authRoutes from '../auth';
import { errorHandler } from '../../middleware/errorHandler';

// Mock dependencies
jest.mock('../../lib/prisma', () => ({
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
  },
}));

jest.mock('../../lib/websocket', () => ({
  broadcastUserCreated: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn((password: string) => Promise.resolve(`hashed_${password}`)),
  compare: jest.fn(),
}));

// Mock rate limiting middleware - just pass through
jest.mock('../../middleware/rateLimit', () => ({
  authRateLimit: (req: express.Request, res: express.Response, next: express.NextFunction) => next(),
}));

describe('Auth Routes - User Registration with Notification', () => {
  let app: express.Application;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set JWT_SECRET for testing
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
    process.env.NODE_ENV = 'test';

    // Create Express app for testing
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    app.use(errorHandler); // Add error handler for proper error responses
  });

  describe('POST /api/auth/register', () => {
    it('should create a new user and broadcast notification to admins', async () => {
      // Arrange
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        password: 'hashed_password123',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const registrationData = {
        email: 'test@example.com',
        password: 'SecurePass!789',
        name: 'Test User',
      };

      // Mock Prisma calls
      // First call: check if user exists (null), Second call: fetch created user (mockUser)
      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // No existing user for registration check
        .mockResolvedValueOnce(mockUser); // Return created user for broadcast
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-123',
        token: 'refresh-token',
        userId: mockUser.id,
        expiresAt: new Date(),
      });

      // Act
      const response = await request(app)
        .post('/api/auth/register')
        .send(registrationData)
        .expect(201);

      // Assert - Check response
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.user.email).toBe(registrationData.email);
      expect(response.body.user.name).toBe(registrationData.name);

      // Assert - Check that user was created
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: registrationData.email },
      });
      expect(prisma.user.create).toHaveBeenCalled();

      // Assert - Check that notification was broadcast
      expect(broadcastUserCreated).toHaveBeenCalledTimes(1);
      expect(broadcastUserCreated).toHaveBeenCalledWith(mockUser);
    });

    it('should not broadcast notification if email already exists', async () => {
      // Arrange
      const existingUser = {
        id: 'existing-user-123',
        email: 'existing@example.com',
        name: 'Existing User',
        password: 'hashedpassword',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const registrationData = {
        email: 'existing@example.com',
        password: 'SecurePass!789',
        name: 'New User',
      };

      // Mock Prisma to return existing user
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(existingUser);

      // Act
      const response = await request(app)
        .post('/api/auth/register')
        .send(registrationData)
        .expect(409);

      // Assert
      expect(response.body.error).toBe('Email already registered');
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(broadcastUserCreated).not.toHaveBeenCalled();
    });

    it('should not broadcast notification if registration fails validation', async () => {
      // Arrange - Invalid email format (Zod validation will catch this)
      const invalidData = {
        email: 'invalid-email', // Invalid email format
        password: 'shortpassword', // Valid password length
        name: 'Valid Name', // Valid name
      };

      // Act - Zod should return 400 for invalid email
      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidData);

      // Assert - Should return error status (400 for validation or 500 if error handler catches it differently)
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(broadcastUserCreated).not.toHaveBeenCalled();
    });

    it('should broadcast notification with correct user data structure', async () => {
      // Arrange
      const mockUser = {
        id: 'user-456',
        email: 'another@example.com',
        name: 'Another User',
        password: 'hashed_password456',
        role: 'user',
        createdAt: new Date('2024-01-15T10:30:00Z'),
        updatedAt: new Date('2024-01-15T10:30:00Z'),
      };

      const registrationData = {
        email: 'another@example.com',
        password: 'SecurePass!456',
        name: 'Another User',
      };

      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // No existing user for registration check
        .mockResolvedValueOnce(mockUser); // Return created user for broadcast
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-456',
        token: 'refresh-token-456',
        userId: mockUser.id,
        expiresAt: new Date(),
      });

      // Act
      await request(app)
        .post('/api/auth/register')
        .send(registrationData)
        .expect(201);

      // Assert - Verify the broadcast was called with exact user object
      expect(broadcastUserCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'user-456',
          email: 'another@example.com',
          name: 'Another User',
          role: 'user',
        })
      );
    });
  });

  describe('broadcastUserCreated function integration', () => {
    it('should be called exactly once per successful registration', async () => {
      // Arrange
      const mockUser = {
        id: 'user-single',
        email: 'single@example.com',
        name: 'Single User',
        password: 'hashed_password',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // No existing user for registration check
        .mockResolvedValueOnce(mockUser); // Return created user for broadcast
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-single',
        token: 'refresh-token',
        userId: mockUser.id,
        expiresAt: new Date(),
      });

      // Act
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'single@example.com',
          password: 'SecurePass!789',
          name: 'Single User',
        })
        .expect(201);

      // Assert
      expect(broadcastUserCreated).toHaveBeenCalledTimes(1);
    });
  });
});

