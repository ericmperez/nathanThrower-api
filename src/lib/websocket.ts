import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { verify } from 'jsonwebtoken';
import { prisma } from './prisma';

let io: SocketIOServer | null = null;

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
}

export interface RealtimeEvent {
  type: string;
  payload: any;
  timestamp: string;
}

/**
 * Initialize WebSocket server
 */
export function initWebSocket(server: HttpServer) {
  // Use same CORS configuration as main app
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : (process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000', 'http://localhost:3001']);

  io = new SocketIOServer(server, {
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps)
        if (!origin) {
          return callback(null, true);
        }
        
        // In development, allow localhost origins
        if (process.env.NODE_ENV !== 'production' && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
          return callback(null, true);
        }
        
        // Check against allowed origins
        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Not allowed by CORS policy`));
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-change-me';
      
      const decoded = verify(token, jwtSecret) as { userId: string; role: string };
      socket.userId = decoded.userId;
      socket.userRole = decoded.role;

      next();
    } catch (error) {
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`✅ WebSocket connected: ${socket.userId} (${socket.userRole})`);

    // Join user-specific room
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }

    // Join admin room if user is admin or nathan
    if (socket.userRole === 'admin' || socket.userRole === 'nathan') {
      socket.join('admin');
    }

    socket.on('disconnect', () => {
      console.log(`❌ WebSocket disconnected: ${socket.userId}`);
    });
  });

  return io;
}

/**
 * Get the WebSocket server instance
 */
export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('WebSocket server not initialized. Call initWebSocket first.');
  }
  return io;
}

/**
 * Broadcast an event to specific users
 */
export function broadcastToUsers(userIds: string[], event: RealtimeEvent) {
  if (!io) return;
  const socket = io;

  userIds.forEach(userId => {
    socket.to(`user:${userId}`).emit('realtime', event);
  });
}

/**
 * Broadcast an event to all admins
 */
export function broadcastToAdmins(event: RealtimeEvent) {
  if (!io) return;
  io.to('admin').emit('realtime', event);
}

/**
 * Broadcast an event to a specific user
 */
export function broadcastToUser(userId: string, event: RealtimeEvent) {
  if (!io) return;
  io.to(`user:${userId}`).emit('realtime', event);
}

/**
 * Broadcast a message event
 */
export async function broadcastMessageEvent(
  message: any,
  senderId: string,
  receiverId: string
) {
  const event: RealtimeEvent = {
    type: 'message:new',
    payload: { message, senderId, receiverId },
    timestamp: new Date().toISOString(),
  };

  // Notify both sender and receiver
  broadcastToUsers([senderId, receiverId], event);

  // Also notify admins if it's a message to/from Nathan
  try {
    const nathan = await prisma.user.findFirst({ where: { role: 'nathan' } });
    if (nathan && (senderId === nathan.id || receiverId === nathan.id)) {
      broadcastToAdmins(event);
    }
  } catch (error) {
    console.error('Error checking Nathan user for admin broadcast:', error);
  }
}

/**
 * Broadcast a conversation update event
 */
export function broadcastConversationUpdate(userId: string) {
  const event: RealtimeEvent = {
    type: 'conversation:update',
    payload: { userId },
    timestamp: new Date().toISOString(),
  };

  broadcastToUser(userId, event);
  broadcastToAdmins(event);
}

/**
 * Broadcast a subscription update event
 */
export function broadcastSubscriptionUpdate(userId: string, subscription: any) {
  const event: RealtimeEvent = {
    type: 'subscription:update',
    payload: { userId, subscription },
    timestamp: new Date().toISOString(),
  };

  broadcastToUser(userId, event);
  broadcastToAdmins(event);
}

/**
 * Broadcast a user update event
 */
export function broadcastUserUpdate(userId: string, user: any) {
  const event: RealtimeEvent = {
    type: 'user:update',
    payload: { userId, user },
    timestamp: new Date().toISOString(),
  };

  broadcastToUser(userId, event);
  broadcastToAdmins(event);
}

/**
 * Broadcast a new user registration event
 */
export function broadcastUserCreated(user: any) {
  const event: RealtimeEvent = {
    type: 'user:new',
    payload: {
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      createdAt: user.createdAt,
    },
    timestamp: new Date().toISOString(),
  };

  // Only notify admins (not the new user themselves)
  broadcastToAdmins(event);
}

/**
 * Broadcast a new analysis event
 */
export function broadcastAnalysisCreated(userId: string, analysis: any) {
  const event: RealtimeEvent = {
    type: 'analysis:new',
    payload: {
      userId,
      analysisId: analysis.id,
      status: analysis.status,
      createdAt: analysis.createdAt,
    },
    timestamp: new Date().toISOString(),
  };

  broadcastToUser(userId, event);
  broadcastToAdmins(event);
}

/**
 * Broadcast an analysis update event
 */
export function broadcastAnalysisUpdate(userId: string, analysis: any) {
  const event: RealtimeEvent = {
    type: 'analysis:update',
    payload: {
      userId,
      analysisId: analysis.id,
      status: analysis.status,
      updatedAt: analysis.updatedAt,
    },
    timestamp: new Date().toISOString(),
  };

  broadcastToUser(userId, event);
  broadcastToAdmins(event);
}

/**
 * Broadcast a pitch count session event
 */
export function broadcastPitchCountSession(userId: string, session: any, eventType: 'new' | 'update') {
  const event: RealtimeEvent = {
    type: `pitchCount:${eventType}`,
    payload: {
      userId,
      sessionId: session.id,
      sessionType: session.sessionType,
      pitchCount: session.pitches?.length || 0,
    },
    timestamp: new Date().toISOString(),
  };

  broadcastToUser(userId, event);
  broadcastToAdmins(event);
}



