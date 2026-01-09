import request from 'supertest';
import express from 'express';
import { prisma } from '../../lib/prisma';
import { broadcastMessageEvent, broadcastConversationUpdate } from '../../lib/websocket';
import messagesRoutes from '../messages';
import { errorHandler } from '../../middleware/errorHandler';

// Mock dependencies
jest.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    subscription: {
      findUnique: jest.fn(),
    },
    message: {
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

jest.mock('../../lib/websocket', () => ({
  broadcastMessageEvent: jest.fn().mockResolvedValue(undefined),
  broadcastConversationUpdate: jest.fn(),
}));

jest.mock('../../lib/s3', () => ({
  generatePresignedViewUrl: jest.fn().mockResolvedValue('https://signed-url.example.com/video'),
}));

// Mock the authenticate middleware
jest.mock('../../middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    // Get user info from custom header for testing
    const userId = req.headers['x-test-user-id'] || 'test-user-id';
    const userRole = req.headers['x-test-user-role'] || 'user';
    req.user = { userId, role: userRole };
    next();
  },
  AuthRequest: {},
}));

// Increase timeout for all tests in this file
jest.setTimeout(10000);

describe('Messages Routes', () => {
  let app: express.Application;

  const mockNathanUser = {
    id: 'nathan-user-id',
    email: 'nathan@example.com',
    name: 'Nathan Thrower',
    role: 'nathan',
  };

  const mockSubscriber = {
    id: 'subscriber-user-id',
    email: 'subscriber@example.com',
    name: 'Test Subscriber',
    role: 'user',
  };

  const mockActiveSubscription = {
    id: 'sub-123',
    userId: 'subscriber-user-id',
    plan: 'monthly',
    status: 'active',
    provider: 'stripe',
    currentPeriodStart: new Date('2024-01-01'),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    cancelAtPeriodEnd: false,
  };

  const mockExpiredSubscription = {
    ...mockActiveSubscription,
    currentPeriodEnd: new Date('2023-01-01'), // Expired
  };

  const mockCancelledSubscription = {
    ...mockActiveSubscription,
    status: 'cancelled',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/messages', messagesRoutes);
    app.use(errorHandler);
  });

  afterAll(() => {
    jest.clearAllMocks();
  });

  // ==========================================
  // GET /api/messages/subscription-status
  // ==========================================
  describe('GET /api/messages/subscription-status', () => {
    it('should return isSubscribed: true for active subscription', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockActiveSubscription);

      const response = await request(app)
        .get('/api/messages/subscription-status')
        .set('x-test-user-id', 'subscriber-user-id')
        .expect(200);

      expect(response.body.isSubscribed).toBe(true);
      expect(response.body.subscription).toBeDefined();
      expect(response.body.subscription.plan).toBe('monthly');
      expect(response.body.subscription.status).toBe('active');
    });

    it('should return isSubscribed: false for expired subscription', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockExpiredSubscription);

      const response = await request(app)
        .get('/api/messages/subscription-status')
        .set('x-test-user-id', 'subscriber-user-id')
        .expect(200);

      expect(response.body.isSubscribed).toBe(false);
    });

    it('should return isSubscribed: false for cancelled subscription', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockCancelledSubscription);

      const response = await request(app)
        .get('/api/messages/subscription-status')
        .set('x-test-user-id', 'subscriber-user-id')
        .expect(200);

      expect(response.body.isSubscribed).toBe(false);
    });

    it('should return isSubscribed: false when no subscription exists', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/messages/subscription-status')
        .set('x-test-user-id', 'subscriber-user-id')
        .expect(200);

      expect(response.body.isSubscribed).toBe(false);
      expect(response.body.subscription).toBeNull();
    });
  });

  // ==========================================
  // GET /api/messages - Get messages with Nathan
  // ==========================================
  describe('GET /api/messages', () => {
    it('should return messages when user has active subscription', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          senderId: 'subscriber-user-id',
          receiverId: 'nathan-user-id',
          content: 'Hello Nathan!',
          isRead: true,
          createdAt: new Date(),
          hasVideo: false,
          videoKey: null,
          videoUrl: null,
          sender: { id: 'subscriber-user-id', name: 'Test Subscriber', role: 'user' },
        },
        {
          id: 'msg-2',
          senderId: 'nathan-user-id',
          receiverId: 'subscriber-user-id',
          content: 'Hi there!',
          isRead: false,
          createdAt: new Date(),
          hasVideo: false,
          videoKey: null,
          videoUrl: null,
          sender: { id: 'nathan-user-id', name: 'Nathan Thrower', role: 'nathan' },
        },
      ];

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockActiveSubscription);
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockNathanUser);
      (prisma.message.findMany as jest.Mock).mockResolvedValue(mockMessages);
      (prisma.message.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const response = await request(app)
        .get('/api/messages')
        .set('x-test-user-id', 'subscriber-user-id')
        .expect(200);

      expect(response.body.messages).toHaveLength(2);
      expect(response.body.messages[0].content).toBe('Hello Nathan!');
      expect(response.body.messages[1].content).toBe('Hi there!');
    });

    it('should return 403 when user has no subscription', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/messages')
        .set('x-test-user-id', 'subscriber-user-id')
        .expect(403);

      expect(response.body.code).toBe('SUBSCRIPTION_REQUIRED');
      expect(response.body.error).toBe('Subscription required');
    });

    it('should return 403 when subscription is expired', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockExpiredSubscription);

      const response = await request(app)
        .get('/api/messages')
        .set('x-test-user-id', 'subscriber-user-id')
        .expect(403);

      expect(response.body.code).toBe('SUBSCRIPTION_REQUIRED');
    });

    it('should return 503 when Nathan user does not exist', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockActiveSubscription);
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/messages')
        .set('x-test-user-id', 'subscriber-user-id')
        .expect(503);

      expect(response.body.error).toBe('Messaging not available');
    });
  });

  // ==========================================
  // POST /api/messages - Send message to Nathan
  // ==========================================
  describe('POST /api/messages', () => {
    it('should send a message successfully when subscribed', async () => {
      const mockCreatedMessage = {
        id: 'msg-new',
        senderId: 'subscriber-user-id',
        receiverId: 'nathan-user-id',
        content: 'Can you help with my pitching?',
        isRead: false,
        createdAt: new Date(),
        hasVideo: false,
        videoKey: null,
        videoUrl: null,
        sender: { id: 'subscriber-user-id', name: 'Test Subscriber', role: 'user' },
      };

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockActiveSubscription);
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockNathanUser);
      (prisma.message.create as jest.Mock).mockResolvedValue(mockCreatedMessage);

      const response = await request(app)
        .post('/api/messages')
        .set('x-test-user-id', 'subscriber-user-id')
        .send({ content: 'Can you help with my pitching?' })
        .expect(201);

      expect(response.body.message.content).toBe('Can you help with my pitching?');
      expect(broadcastMessageEvent).toHaveBeenCalled();
      expect(broadcastConversationUpdate).toHaveBeenCalledTimes(2);
    });

    it('should send a message with video attachment', async () => {
      const mockCreatedMessage = {
        id: 'msg-video',
        senderId: 'subscriber-user-id',
        receiverId: 'nathan-user-id',
        content: 'Check my form',
        isRead: false,
        createdAt: new Date(),
        hasVideo: true,
        videoKey: 'videos/my-video.mp4',
        videoUrl: 'https://s3.example.com/videos/my-video.mp4',
        sender: { id: 'subscriber-user-id', name: 'Test Subscriber', role: 'user' },
      };

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockActiveSubscription);
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockNathanUser);
      (prisma.message.create as jest.Mock).mockResolvedValue(mockCreatedMessage);

      const response = await request(app)
        .post('/api/messages')
        .set('x-test-user-id', 'subscriber-user-id')
        .send({
          content: 'Check my form',
          videoUrl: 'https://s3.example.com/videos/my-video.mp4',
          videoKey: 'videos/my-video.mp4',
        })
        .expect(201);

      expect(response.body.message.hasVideo).toBe(true);
      expect(response.body.message.videoKey).toBe('videos/my-video.mp4');
    });

    it('should return 403 when user has no subscription', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/api/messages')
        .set('x-test-user-id', 'subscriber-user-id')
        .send({ content: 'Hello!' })
        .expect(403);

      expect(response.body.code).toBe('SUBSCRIPTION_REQUIRED');
    });

    it('should return 400 for empty message content', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockActiveSubscription);
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockNathanUser);

      const response = await request(app)
        .post('/api/messages')
        .set('x-test-user-id', 'subscriber-user-id')
        .send({ content: '' })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('should return 400 when only videoUrl is provided without videoKey', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockActiveSubscription);
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockNathanUser);

      const response = await request(app)
        .post('/api/messages')
        .set('x-test-user-id', 'subscriber-user-id')
        .send({
          content: 'Check this',
          videoUrl: 'https://example.com/video.mp4',
        })
        .expect(400);

      expect(response.body.error).toContain('videoUrl and videoKey must be provided together');
    });
  });

  // ==========================================
  // GET /api/messages/unread-count
  // ==========================================
  describe('GET /api/messages/unread-count', () => {
    it('should return unread message count', async () => {
      (prisma.message.count as jest.Mock).mockResolvedValue(5);

      const response = await request(app)
        .get('/api/messages/unread-count')
        .set('x-test-user-id', 'subscriber-user-id')
        .expect(200);

      expect(response.body.unreadCount).toBe(5);
    });

    it('should return 0 when no unread messages', async () => {
      (prisma.message.count as jest.Mock).mockResolvedValue(0);

      const response = await request(app)
        .get('/api/messages/unread-count')
        .set('x-test-user-id', 'subscriber-user-id')
        .expect(200);

      expect(response.body.unreadCount).toBe(0);
    });
  });

  // ==========================================
  // GET /api/messages/conversations (Nathan/Admin only)
  // ==========================================
  describe('GET /api/messages/conversations', () => {
    it('should return conversations for Nathan', async () => {
      const mockMessages = [
        {
          sender: { id: 'user-1', name: 'User One', email: 'user1@example.com' },
          receiver: { id: 'nathan-user-id', name: 'Nathan', email: 'nathan@example.com' },
          content: 'Hello',
          createdAt: new Date(),
          isRead: false,
          videoUrl: null,
        },
      ];

      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockNathanUser);
      (prisma.message.findMany as jest.Mock).mockResolvedValue(mockMessages);

      const response = await request(app)
        .get('/api/messages/conversations')
        .set('x-test-user-id', 'nathan-user-id')
        .set('x-test-user-role', 'nathan')
        .expect(200);

      expect(response.body.conversations).toBeDefined();
      expect(Array.isArray(response.body.conversations)).toBe(true);
    });

    it('should return 403 for regular users', async () => {
      const response = await request(app)
        .get('/api/messages/conversations')
        .set('x-test-user-id', 'subscriber-user-id')
        .set('x-test-user-role', 'user')
        .expect(403);

      expect(response.body.error).toBe('Not authorized');
    });

    it('should return conversations for admin', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockNathanUser);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .get('/api/messages/conversations')
        .set('x-test-user-id', 'admin-user-id')
        .set('x-test-user-role', 'admin')
        .expect(200);

      expect(response.body.conversations).toBeDefined();
    });
  });

  // ==========================================
  // GET /api/messages/user/:userId (Nathan/Admin only)
  // ==========================================
  describe('GET /api/messages/user/:userId', () => {
    it('should return messages for specific user when Nathan', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          senderId: 'user-1',
          receiverId: 'nathan-user-id',
          content: 'Question about curveball',
          isRead: true,
          createdAt: new Date(),
          hasVideo: false,
          videoKey: null,
          videoUrl: null,
          sender: { id: 'user-1', name: 'User One', role: 'user' },
        },
      ];

      (prisma.message.findMany as jest.Mock).mockResolvedValue(mockMessages);
      (prisma.message.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const response = await request(app)
        .get('/api/messages/user/user-1')
        .set('x-test-user-id', 'nathan-user-id')
        .set('x-test-user-role', 'nathan')
        .expect(200);

      expect(response.body.messages).toHaveLength(1);
      expect(response.body.messages[0].content).toBe('Question about curveball');
    });

    it('should return 403 for regular users', async () => {
      const response = await request(app)
        .get('/api/messages/user/other-user-id')
        .set('x-test-user-id', 'subscriber-user-id')
        .set('x-test-user-role', 'user')
        .expect(403);

      expect(response.body.error).toBe('Not authorized');
    });
  });

  // ==========================================
  // POST /api/messages/user/:userId (Nathan/Admin reply)
  // ==========================================
  describe('POST /api/messages/user/:userId', () => {
    it('should allow Nathan to reply to a user', async () => {
      const mockCreatedMessage = {
        id: 'msg-reply',
        senderId: 'nathan-user-id',
        receiverId: 'user-1',
        content: 'Great question! Here is my advice...',
        isRead: false,
        createdAt: new Date(),
        hasVideo: false,
        videoKey: null,
        videoUrl: null,
        sender: { id: 'nathan-user-id', name: 'Nathan', role: 'nathan' },
      };

      (prisma.message.create as jest.Mock).mockResolvedValue(mockCreatedMessage);

      const response = await request(app)
        .post('/api/messages/user/user-1')
        .set('x-test-user-id', 'nathan-user-id')
        .set('x-test-user-role', 'nathan')
        .send({ content: 'Great question! Here is my advice...' })
        .expect(201);

      expect(response.body.message.content).toBe('Great question! Here is my advice...');
      expect(broadcastMessageEvent).toHaveBeenCalled();
      expect(broadcastConversationUpdate).toHaveBeenCalledTimes(2);
    });

    it('should allow admin to reply to a user', async () => {
      const mockCreatedMessage = {
        id: 'msg-admin-reply',
        senderId: 'admin-user-id',
        receiverId: 'user-1',
        content: 'Admin response',
        isRead: false,
        createdAt: new Date(),
        hasVideo: false,
        videoKey: null,
        videoUrl: null,
        sender: { id: 'admin-user-id', name: 'Admin', role: 'admin' },
      };

      (prisma.message.create as jest.Mock).mockResolvedValue(mockCreatedMessage);

      const response = await request(app)
        .post('/api/messages/user/user-1')
        .set('x-test-user-id', 'admin-user-id')
        .set('x-test-user-role', 'admin')
        .send({ content: 'Admin response' })
        .expect(201);

      expect(response.body.message.content).toBe('Admin response');
    });

    it('should return 403 for regular users trying to reply', async () => {
      const response = await request(app)
        .post('/api/messages/user/other-user-id')
        .set('x-test-user-id', 'subscriber-user-id')
        .set('x-test-user-role', 'user')
        .send({ content: 'Trying to impersonate Nathan' })
        .expect(403);

      expect(response.body.error).toBe('Not authorized');
    });

    it('should return 400 for empty message content', async () => {
      const response = await request(app)
        .post('/api/messages/user/user-1')
        .set('x-test-user-id', 'nathan-user-id')
        .set('x-test-user-role', 'nathan')
        .send({ content: '' })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });

  // ==========================================
  // End-to-End Message Flow Test
  // ==========================================
  describe('End-to-End Message Flow', () => {
    it('should support complete message flow: check subscription -> send message -> get messages', async () => {
      // Step 1: Check subscription status
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockActiveSubscription);

      const statusResponse = await request(app)
        .get('/api/messages/subscription-status')
        .set('x-test-user-id', 'subscriber-user-id')
        .expect(200);

      expect(statusResponse.body.isSubscribed).toBe(true);

      // Step 2: Send a message
      const mockCreatedMessage = {
        id: 'msg-e2e',
        senderId: 'subscriber-user-id',
        receiverId: 'nathan-user-id',
        content: 'E2E test message',
        isRead: false,
        createdAt: new Date(),
        hasVideo: false,
        videoKey: null,
        videoUrl: null,
        sender: { id: 'subscriber-user-id', name: 'Test Subscriber', role: 'user' },
      };

      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockNathanUser);
      (prisma.message.create as jest.Mock).mockResolvedValue(mockCreatedMessage);

      const sendResponse = await request(app)
        .post('/api/messages')
        .set('x-test-user-id', 'subscriber-user-id')
        .send({ content: 'E2E test message' })
        .expect(201);

      expect(sendResponse.body.message.content).toBe('E2E test message');

      // Step 3: Verify WebSocket events were broadcast
      expect(broadcastMessageEvent).toHaveBeenCalled();
      expect(broadcastConversationUpdate).toHaveBeenCalled();

      // Step 4: Get messages (simulating the messages showing up)
      (prisma.message.findMany as jest.Mock).mockResolvedValue([mockCreatedMessage]);
      (prisma.message.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const getResponse = await request(app)
        .get('/api/messages')
        .set('x-test-user-id', 'subscriber-user-id')
        .expect(200);

      expect(getResponse.body.messages).toHaveLength(1);
      expect(getResponse.body.messages[0].content).toBe('E2E test message');
    });
  });

  // ==========================================
  // WebSocket Event Broadcasting Tests
  // ==========================================
  describe('WebSocket Event Broadcasting', () => {
    it('should broadcast message event when message is sent', async () => {
      const mockCreatedMessage = {
        id: 'msg-ws',
        senderId: 'subscriber-user-id',
        receiverId: 'nathan-user-id',
        content: 'WebSocket test',
        isRead: false,
        createdAt: new Date(),
        hasVideo: false,
        videoKey: null,
        videoUrl: null,
        sender: { id: 'subscriber-user-id', name: 'Test', role: 'user' },
      };

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockActiveSubscription);
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockNathanUser);
      (prisma.message.create as jest.Mock).mockResolvedValue(mockCreatedMessage);

      await request(app)
        .post('/api/messages')
        .set('x-test-user-id', 'subscriber-user-id')
        .send({ content: 'WebSocket test' })
        .expect(201);

      // Verify broadcastMessageEvent was called with correct parameters
      expect(broadcastMessageEvent).toHaveBeenCalledWith(
        mockCreatedMessage,
        'subscriber-user-id',
        'nathan-user-id'
      );

      // Verify broadcastConversationUpdate was called for both users
      expect(broadcastConversationUpdate).toHaveBeenCalledWith('subscriber-user-id');
      expect(broadcastConversationUpdate).toHaveBeenCalledWith('nathan-user-id');
    });

    it('should broadcast when Nathan replies', async () => {
      const mockReply = {
        id: 'msg-nathan-reply',
        senderId: 'nathan-user-id',
        receiverId: 'user-1',
        content: 'Nathan reply',
        isRead: false,
        createdAt: new Date(),
        hasVideo: false,
        videoKey: null,
        videoUrl: null,
        sender: { id: 'nathan-user-id', name: 'Nathan', role: 'nathan' },
      };

      (prisma.message.create as jest.Mock).mockResolvedValue(mockReply);

      await request(app)
        .post('/api/messages/user/user-1')
        .set('x-test-user-id', 'nathan-user-id')
        .set('x-test-user-role', 'nathan')
        .send({ content: 'Nathan reply' })
        .expect(201);

      expect(broadcastMessageEvent).toHaveBeenCalledWith(
        mockReply,
        'nathan-user-id',
        'user-1'
      );
    });
  });
});
