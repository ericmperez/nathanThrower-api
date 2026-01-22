import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { verify } from 'jsonwebtoken';
import { prisma } from './prisma';
import {
  SendChatMessageSchema,
  MarkMessagesReadSchema,
  TypingIndicatorSchema,
  SocketMessagePayload,
  SocketReadReceiptPayload,
  SocketTypingPayload,
} from '@pitchcoach/shared';

let io: SocketIOServer | null = null;

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
  userName?: string;
}

export interface RealtimeEvent {
  type: string;
  payload: any;
  timestamp: string;
}

// Track typing indicators with auto-expiry
const typingUsers = new Map<string, Map<string, NodeJS.Timeout>>(); // chatId -> userId -> timeout

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

      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        return next(new Error('Server configuration error: JWT_SECRET not set'));
      }

      const decoded = verify(token, jwtSecret) as { userId: string; role: string; name?: string };
      socket.userId = decoded.userId;
      socket.userRole = decoded.role;

      // Fetch user name if not in token
      if (!decoded.name) {
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { name: true },
        });
        socket.userName = user?.name || 'Unknown';
      } else {
        socket.userName = decoded.name;
      }

      next();
    } catch (error) {
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    console.log(`✅ WebSocket connected: ${socket.userId} (${socket.userRole})`);

    // Join user-specific room
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);

      // Update user presence to online
      await updateUserPresence(socket.userId, true, socket.id);

      // Join all chat rooms this user is a participant of
      const participations = await prisma.chatParticipant.findMany({
        where: { userId: socket.userId, leftAt: null },
        select: { chatId: true },
      });

      for (const p of participations) {
        socket.join(`chat:${p.chatId}`);
      }

      // Broadcast online status to relevant users
      broadcastUserStatus(socket.userId, true);
    }

    // Join admin room if user is admin or nathan
    if (socket.userRole === 'admin' || socket.userRole === 'nathan') {
      socket.join('admin');
    }

    // ==================== CHAT EVENTS ====================

    // Send a message
    socket.on('message:send', async (payload: SocketMessagePayload, callback) => {
      try {
        if (!socket.userId) {
          callback?.({ error: 'Not authenticated' });
          return;
        }

        const validated = SendChatMessageSchema.safeParse(payload);
        if (!validated.success) {
          callback?.({ error: validated.error.errors[0].message });
          return;
        }

        const { chatId, content } = validated.data;

        // Verify user is a participant
        const participant = await prisma.chatParticipant.findUnique({
          where: { chatId_userId: { chatId, userId: socket.userId } },
        });

        if (!participant || participant.leftAt) {
          callback?.({ error: 'You are not a participant of this chat' });
          return;
        }

        // Create the message
        const message = await prisma.chatMessage.create({
          data: {
            chatId,
            senderId: socket.userId,
            content,
          },
          include: {
            sender: {
              select: { id: true, name: true, profilePicture: true },
            },
          },
        });

        // Update chat's updatedAt
        await prisma.chat.update({
          where: { id: chatId },
          data: { updatedAt: new Date() },
        });

        // Broadcast to all chat participants
        io?.to(`chat:${chatId}`).emit('message:new', { message });

        // Clear typing indicator
        clearTypingIndicator(chatId, socket.userId);
        io?.to(`chat:${chatId}`).emit('typing:stop', {
          chatId,
          userId: socket.userId,
        });

        callback?.({ success: true, message });
      } catch (error) {
        console.error('Error sending message:', error);
        callback?.({ error: 'Failed to send message' });
      }
    });

    // Mark messages as read
    socket.on('message:read', async (payload: SocketReadReceiptPayload, callback) => {
      try {
        if (!socket.userId) {
          callback?.({ error: 'Not authenticated' });
          return;
        }

        const validated = MarkMessagesReadSchema.safeParse(payload);
        if (!validated.success) {
          callback?.({ error: validated.error.errors[0].message });
          return;
        }

        const { chatId, messageIds } = validated.data;

        // Verify user is a participant
        const participant = await prisma.chatParticipant.findUnique({
          where: { chatId_userId: { chatId, userId: socket.userId } },
        });

        if (!participant || participant.leftAt) {
          callback?.({ error: 'You are not a participant of this chat' });
          return;
        }

        const now = new Date();

        // Create read receipts
        await prisma.chatMessageReceipt.createMany({
          data: messageIds.map(messageId => ({
            messageId,
            userId: socket.userId!,
            readAt: now,
          })),
          skipDuplicates: true,
        });

        // Update participant's lastReadAt
        await prisma.chatParticipant.update({
          where: { chatId_userId: { chatId, userId: socket.userId } },
          data: { lastReadAt: now },
        });

        // Update message status to READ for messages sent by others
        await prisma.chatMessage.updateMany({
          where: {
            id: { in: messageIds },
            senderId: { not: socket.userId },
            status: { not: 'READ' },
          },
          data: { status: 'READ' },
        });

        // Broadcast read receipt to chat
        io?.to(`chat:${chatId}`).emit('message:read', {
          chatId,
          messageIds,
          readBy: {
            userId: socket.userId,
            userName: socket.userName,
            readAt: now,
          },
        });

        callback?.({ success: true });
      } catch (error) {
        console.error('Error marking messages as read:', error);
        callback?.({ error: 'Failed to mark messages as read' });
      }
    });

    // Start typing
    socket.on('typing:start', async (payload: SocketTypingPayload) => {
      try {
        if (!socket.userId) return;

        const validated = TypingIndicatorSchema.safeParse(payload);
        if (!validated.success) return;

        const { chatId } = validated.data;

        // Verify user is a participant
        const participant = await prisma.chatParticipant.findUnique({
          where: { chatId_userId: { chatId, userId: socket.userId } },
        });

        if (!participant || participant.leftAt) return;

        // Set typing indicator with auto-expiry
        setTypingIndicator(chatId, socket.userId, socket.userName || 'Unknown');

        // Broadcast typing to other participants
        socket.to(`chat:${chatId}`).emit('typing:start', {
          chatId,
          userId: socket.userId,
          userName: socket.userName,
        });
      } catch (error) {
        console.error('Error handling typing:start:', error);
      }
    });

    // Stop typing
    socket.on('typing:stop', async (payload: SocketTypingPayload) => {
      try {
        if (!socket.userId) return;

        const validated = TypingIndicatorSchema.safeParse(payload);
        if (!validated.success) return;

        const { chatId } = validated.data;

        clearTypingIndicator(chatId, socket.userId);

        socket.to(`chat:${chatId}`).emit('typing:stop', {
          chatId,
          userId: socket.userId,
        });
      } catch (error) {
        console.error('Error handling typing:stop:', error);
      }
    });

    // Join a chat room (called when user opens a chat)
    socket.on('chat:join', async (chatId: string) => {
      if (!socket.userId) return;

      // Verify user is a participant
      const participant = await prisma.chatParticipant.findUnique({
        where: { chatId_userId: { chatId, userId: socket.userId } },
      });

      if (participant && !participant.leftAt) {
        socket.join(`chat:${chatId}`);
      }
    });

    // Leave a chat room (called when user closes a chat)
    socket.on('chat:leave', (chatId: string) => {
      socket.leave(`chat:${chatId}`);
      if (socket.userId) {
        clearTypingIndicator(chatId, socket.userId);
      }
    });

    socket.on('disconnect', async () => {
      console.log(`❌ WebSocket disconnected: ${socket.userId}`);

      if (socket.userId) {
        // Update user presence to offline
        await updateUserPresence(socket.userId, false, null);

        // Broadcast offline status
        broadcastUserStatus(socket.userId, false);

        // Clear all typing indicators for this user
        typingUsers.forEach((users, chatId) => {
          if (users.has(socket.userId!)) {
            clearTypingIndicator(chatId, socket.userId!);
            io?.to(`chat:${chatId}`).emit('typing:stop', {
              chatId,
              userId: socket.userId,
            });
          }
        });
      }
    });
  });

  return io;
}

/**
 * Update user presence in database
 */
async function updateUserPresence(userId: string, isOnline: boolean, socketId: string | null) {
  try {
    await prisma.userPresence.upsert({
      where: { userId },
      update: {
        isOnline,
        socketId,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        isOnline,
        socketId,
        lastSeenAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error updating user presence:', error);
  }
}

/**
 * Broadcast user online/offline status to relevant users
 */
async function broadcastUserStatus(userId: string, isOnline: boolean) {
  if (!io) return;

  try {
    // Find all users who share a chat with this user
    const participations = await prisma.chatParticipant.findMany({
      where: { userId, leftAt: null },
      select: { chatId: true },
    });

    const chatIds = participations.map(p => p.chatId);

    // Get all users in those chats
    const coParticipants = await prisma.chatParticipant.findMany({
      where: {
        chatId: { in: chatIds },
        userId: { not: userId },
        leftAt: null,
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    const userIds = coParticipants.map(p => p.userId);

    // Get last seen time
    const presence = await prisma.userPresence.findUnique({
      where: { userId },
      select: { lastSeenAt: true },
    });

    // Broadcast to all relevant users
    for (const id of userIds) {
      io.to(`user:${id}`).emit('user:online', {
        userId,
        isOnline,
        lastSeenAt: presence?.lastSeenAt,
      });
    }
  } catch (error) {
    console.error('Error broadcasting user status:', error);
  }
}

/**
 * Set typing indicator with auto-expiry
 */
function setTypingIndicator(chatId: string, userId: string, userName: string) {
  // Clear existing timeout
  clearTypingIndicator(chatId, userId);

  // Create chat map if doesn't exist
  if (!typingUsers.has(chatId)) {
    typingUsers.set(chatId, new Map());
  }

  // Set timeout to auto-clear after 5 seconds
  const timeout = setTimeout(() => {
    clearTypingIndicator(chatId, userId);
    io?.to(`chat:${chatId}`).emit('typing:stop', { chatId, userId });
  }, 5000);

  typingUsers.get(chatId)!.set(userId, timeout);
}

/**
 * Clear typing indicator
 */
function clearTypingIndicator(chatId: string, userId: string) {
  const chatTyping = typingUsers.get(chatId);
  if (chatTyping) {
    const timeout = chatTyping.get(userId);
    if (timeout) {
      clearTimeout(timeout);
      chatTyping.delete(userId);
    }
    if (chatTyping.size === 0) {
      typingUsers.delete(chatId);
    }
  }
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

/**
 * Broadcast a new chat event to participants
 */
export function broadcastChatCreated(chat: any, participantIds: string[]) {
  if (!io) return;

  for (const userId of participantIds) {
    io.to(`user:${userId}`).emit('chat:new', { chat });

    // Make the user join the chat room if they're connected
    const sockets = io.sockets.sockets;
    sockets.forEach((socket: AuthenticatedSocket) => {
      if (socket.userId === userId) {
        socket.join(`chat:${chat.id}`);
      }
    });
  }
}

/**
 * Broadcast when a user is added to a chat
 */
export function broadcastChatParticipantAdded(chatId: string, chat: any, addedUserIds: string[]) {
  if (!io) return;

  // Notify new participants
  for (const userId of addedUserIds) {
    io.to(`user:${userId}`).emit('chat:new', { chat });

    // Make the user join the chat room if they're connected
    const sockets = io.sockets.sockets;
    sockets.forEach((socket: AuthenticatedSocket) => {
      if (socket.userId === userId) {
        socket.join(`chat:${chatId}`);
      }
    });
  }

  // Notify existing participants
  io.to(`chat:${chatId}`).emit('chat:updated', { chat });
}

/**
 * Broadcast when a user is removed from a chat
 */
export function broadcastChatParticipantRemoved(chatId: string, removedUserId: string, chat: any) {
  if (!io) return;

  // Notify removed user
  io.to(`user:${removedUserId}`).emit('chat:removed', { chatId });

  // Make the user leave the chat room
  const sockets = io.sockets.sockets;
  sockets.forEach((socket: AuthenticatedSocket) => {
    if (socket.userId === removedUserId) {
      socket.leave(`chat:${chatId}`);
    }
  });

  // Notify remaining participants
  io.to(`chat:${chatId}`).emit('chat:updated', { chat });
}

/**
 * Get online status for multiple users
 */
export async function getOnlineUsers(userIds: string[]): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();

  const presences = await prisma.userPresence.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, isOnline: true },
  });

  for (const presence of presences) {
    result.set(presence.userId, presence.isOnline);
  }

  // Users without presence records are offline
  for (const userId of userIds) {
    if (!result.has(userId)) {
      result.set(userId, false);
    }
  }

  return result;
}



