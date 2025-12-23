import { Request, Response, NextFunction } from 'express';
import { authenticate, requireAdmin, AuthRequest } from './auth';
import { generateAccessToken, verifyToken } from '../lib/jwt';

describe('Admin Authentication Middleware', () => {
  let mockRequest: Partial<AuthRequest>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    // Set JWT_SECRET for testing
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
    
    mockRequest = {
      headers: {},
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
  });

  describe('requireAdmin', () => {
    it('should allow access for admin role', () => {
      // Create a mock JWT payload for admin user
      const adminPayload = {
        userId: 'admin-user-id',
        email: 'admin@test.com',
        role: 'admin',
      };

      // Mock the request with user set (simulating authenticate middleware already ran)
      mockRequest.user = adminPayload;

      requireAdmin(mockRequest as AuthRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should allow access for nathan role', () => {
      // Create a mock JWT payload for nathan user
      const nathanPayload = {
        userId: 'nathan-user-id',
        email: 'nathan@test.com',
        role: 'nathan',
      };

      // Mock the request with user set (simulating authenticate middleware already ran)
      mockRequest.user = nathanPayload;

      requireAdmin(mockRequest as AuthRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should deny access for user role', () => {
      // Create a mock JWT payload for regular user
      const userPayload = {
        userId: 'user-id',
        email: 'user@test.com',
        role: 'user',
      };

      // Mock the request with user set (simulating authenticate middleware already ran)
      mockRequest.user = userPayload;

      requireAdmin(mockRequest as AuthRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Admin access required' });
    });

    it('should deny access when user is undefined', () => {
      // Mock the request without user set
      mockRequest.user = undefined;

      requireAdmin(mockRequest as AuthRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Admin access required' });
    });

    it('should deny access for unknown role', () => {
      // Create a mock JWT payload with unknown role
      const unknownPayload = {
        userId: 'unknown-id',
        email: 'unknown@test.com',
        role: 'unknown',
      };

      // Mock the request with user set
      mockRequest.user = unknownPayload;

      requireAdmin(mockRequest as AuthRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Admin access required' });
    });
  });

  describe('Integration: requireAdmin with real tokens', () => {
    beforeEach(() => {
      process.env.JWT_SECRET = 'test-secret-for-admin-tests';
    });

    it('should allow admin token through requireAdmin', () => {
      const adminToken = generateAccessToken({
        id: 'admin-id',
        email: 'admin@test.com',
        role: 'admin',
      });

      const payload = verifyToken(adminToken);
      mockRequest.user = payload;

      requireAdmin(mockRequest as AuthRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should allow nathan token through requireAdmin', () => {
      const nathanToken = generateAccessToken({
        id: 'nathan-id',
        email: 'nathan@test.com',
        role: 'nathan',
      });

      const payload = verifyToken(nathanToken);
      mockRequest.user = payload;

      requireAdmin(mockRequest as AuthRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should reject user token in requireAdmin', () => {
      const userToken = generateAccessToken({
        id: 'user-id',
        email: 'user@test.com',
        role: 'user',
      });

      const payload = verifyToken(userToken);
      mockRequest.user = payload;

      requireAdmin(mockRequest as AuthRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Admin access required' });
    });
  });
});

