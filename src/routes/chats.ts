import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  CreateDirectChatSchema,
  CreateGroupChatSchema,
  UpdateGroupChatSchema,
} from '@pitchcoach/shared';
import {
  broadcastChatCreated,
  broadcastChatParticipantAdded,
  broadcastChatParticipantRemoved,
  getOnlineUsers,
} from '../lib/websocket';
import { z } from 'zod';

const router = Router();

// Common include for chat queries
const chatInclude = {
  participants: {
    where: { leftAt: null },
    include: {
      user: {
        select: { id: true, name: true, profilePicture: true },
      },
    },
  },
  messages: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    include: {
      sender: {
        select: { id: true, name: true, profilePicture: true },
      },
    },
  },
};

/**
 * GET /api/chats - List user's chats
 */
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Find all chats where user is an active participant
    const participations = await prisma.chatParticipant.findMany({
      where: { userId, leftAt: null },
      select: { chatId: true, lastReadAt: true },
    });

    const chatIds = participations.map(p => p.chatId);
    const lastReadMap = new Map(participations.map(p => [p.chatId, p.lastReadAt]));

    const chats = await prisma.chat.findMany({
      where: { id: { in: chatIds } },
      include: chatInclude,
      orderBy: { updatedAt: 'desc' },
    });

    // Calculate unread counts for each chat
    const chatsWithUnread = await Promise.all(
      chats.map(async (chat) => {
        const lastReadAt = lastReadMap.get(chat.id);
        const unreadCount = await prisma.chatMessage.count({
          where: {
            chatId: chat.id,
            senderId: { not: userId },
            createdAt: lastReadAt ? { gt: lastReadAt } : undefined,
            deletedAt: null,
          },
        });

        return {
          ...chat,
          lastMessage: chat.messages[0] || null,
          messages: undefined, // Remove messages array
          unreadCount,
        };
      })
    );

    res.json({ chats: chatsWithUnread });
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Failed to get chats' });
  }
});

/**
 * POST /api/chats/direct - Create or get existing direct chat
 */
router.post('/direct', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const body = CreateDirectChatSchema.parse(req.body);
    const { participantId } = body;

    // Can't create chat with yourself
    if (participantId === userId) {
      return res.status(400).json({ error: 'Cannot create a chat with yourself' });
    }

    // Verify the other user exists
    const otherUser = await prisma.user.findUnique({
      where: { id: participantId },
      select: { id: true },
    });

    if (!otherUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if a direct chat already exists between these users
    const existingChat = await prisma.chat.findFirst({
      where: {
        type: 'DIRECT',
        AND: [
          { participants: { some: { userId, leftAt: null } } },
          { participants: { some: { userId: participantId, leftAt: null } } },
        ],
      },
      include: chatInclude,
    });

    if (existingChat) {
      return res.json({
        chat: {
          ...existingChat,
          lastMessage: existingChat.messages[0] || null,
          messages: undefined,
        },
        isNew: false,
      });
    }

    // Create new direct chat
    const chat = await prisma.chat.create({
      data: {
        type: 'DIRECT',
        createdById: userId,
        participants: {
          create: [
            { userId, isAdmin: false },
            { userId: participantId, isAdmin: false },
          ],
        },
      },
      include: chatInclude,
    });

    // Broadcast to participants
    broadcastChatCreated(chat, [userId, participantId]);

    res.status(201).json({
      chat: {
        ...chat,
        lastMessage: null,
        messages: undefined,
      },
      isNew: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create direct chat error:', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

/**
 * POST /api/chats/group - Create a group chat
 */
router.post('/group', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const body = CreateGroupChatSchema.parse(req.body);
    const { name, participantIds } = body;

    // Remove duplicates and add creator if not included
    const uniqueParticipantIds = [...new Set([userId, ...participantIds])];

    // Verify all users exist
    const users = await prisma.user.findMany({
      where: { id: { in: uniqueParticipantIds } },
      select: { id: true },
    });

    if (users.length !== uniqueParticipantIds.length) {
      return res.status(400).json({ error: 'One or more users not found' });
    }

    // Create group chat
    const chat = await prisma.chat.create({
      data: {
        type: 'GROUP',
        name,
        createdById: userId,
        participants: {
          create: uniqueParticipantIds.map(id => ({
            userId: id,
            isAdmin: id === userId, // Creator is admin
          })),
        },
      },
      include: chatInclude,
    });

    // Broadcast to all participants
    broadcastChatCreated(chat, uniqueParticipantIds);

    res.status(201).json({
      chat: {
        ...chat,
        lastMessage: null,
        messages: undefined,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create group chat error:', error);
    res.status(500).json({ error: 'Failed to create group chat' });
  }
});

/**
 * GET /api/chats/:id - Get a specific chat
 */
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    // Verify user is a participant
    const participant = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId: id, userId } },
    });

    if (!participant || participant.leftAt) {
      return res.status(403).json({ error: 'You are not a participant of this chat' });
    }

    const chat = await prisma.chat.findUnique({
      where: { id },
      include: chatInclude,
    });

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    // Calculate unread count
    const unreadCount = await prisma.chatMessage.count({
      where: {
        chatId: id,
        senderId: { not: userId },
        createdAt: participant.lastReadAt ? { gt: participant.lastReadAt } : undefined,
        deletedAt: null,
      },
    });

    res.json({
      chat: {
        ...chat,
        lastMessage: chat.messages[0] || null,
        messages: undefined,
        unreadCount,
      },
    });
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ error: 'Failed to get chat' });
  }
});

/**
 * PUT /api/chats/:id - Update a group chat (admin only)
 */
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const body = UpdateGroupChatSchema.parse(req.body);

    // Verify chat exists and is a group chat
    const chat = await prisma.chat.findUnique({
      where: { id },
      include: { participants: { where: { leftAt: null } } },
    });

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    if (chat.type !== 'GROUP') {
      return res.status(400).json({ error: 'Cannot update a direct chat' });
    }

    // Verify user is an admin
    const userParticipant = chat.participants.find(p => p.userId === userId);
    if (!userParticipant || !userParticipant.isAdmin) {
      return res.status(403).json({ error: 'Only admins can update the chat' });
    }

    // Update name if provided
    if (body.name) {
      await prisma.chat.update({
        where: { id },
        data: { name: body.name },
      });
    }

    // Add new participants
    if (body.addParticipantIds && body.addParticipantIds.length > 0) {
      // Filter out existing participants
      const existingUserIds = chat.participants.map(p => p.userId);
      const newParticipantIds = body.addParticipantIds.filter(
        id => !existingUserIds.includes(id)
      );

      if (newParticipantIds.length > 0) {
        // Verify users exist
        const users = await prisma.user.findMany({
          where: { id: { in: newParticipantIds } },
          select: { id: true },
        });

        const validIds = users.map(u => u.id);

        await prisma.chatParticipant.createMany({
          data: validIds.map(participantId => ({
            chatId: id,
            userId: participantId,
            isAdmin: false,
          })),
          skipDuplicates: true,
        });
      }
    }

    // Remove participants
    if (body.removeParticipantIds && body.removeParticipantIds.length > 0) {
      // Can't remove yourself through this endpoint
      const idsToRemove = body.removeParticipantIds.filter(id => id !== userId);

      for (const removeId of idsToRemove) {
        await prisma.chatParticipant.updateMany({
          where: { chatId: id, userId: removeId, leftAt: null },
          data: { leftAt: new Date() },
        });
      }
    }

    // Fetch updated chat
    const updatedChat = await prisma.chat.findUnique({
      where: { id },
      include: chatInclude,
    });

    // Broadcast updates
    if (body.addParticipantIds && body.addParticipantIds.length > 0) {
      broadcastChatParticipantAdded(id, updatedChat, body.addParticipantIds);
    }

    if (body.removeParticipantIds) {
      for (const removedId of body.removeParticipantIds) {
        if (removedId !== userId) {
          broadcastChatParticipantRemoved(id, removedId, updatedChat);
        }
      }
    }

    res.json({
      chat: {
        ...updatedChat,
        lastMessage: updatedChat?.messages[0] || null,
        messages: undefined,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update chat error:', error);
    res.status(500).json({ error: 'Failed to update chat' });
  }
});

/**
 * DELETE /api/chats/:id/leave - Leave a chat
 */
router.delete('/:id/leave', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const chat = await prisma.chat.findUnique({
      where: { id },
      include: { participants: { where: { leftAt: null } } },
    });

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    // Can't leave a direct chat
    if (chat.type === 'DIRECT') {
      return res.status(400).json({ error: 'Cannot leave a direct chat' });
    }

    // Mark participant as left
    await prisma.chatParticipant.updateMany({
      where: { chatId: id, userId, leftAt: null },
      data: { leftAt: new Date() },
    });

    // Fetch updated chat
    const updatedChat = await prisma.chat.findUnique({
      where: { id },
      include: chatInclude,
    });

    // Broadcast removal
    broadcastChatParticipantRemoved(id, userId, updatedChat);

    res.json({ success: true });
  } catch (error) {
    console.error('Leave chat error:', error);
    res.status(500).json({ error: 'Failed to leave chat' });
  }
});

/**
 * GET /api/chats/:id/messages - Get messages for a chat (paginated)
 */
router.get('/:id/messages', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const cursor = req.query.cursor as string | undefined;

    // Verify user is a participant
    const participant = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId: id, userId } },
    });

    if (!participant || participant.leftAt) {
      return res.status(403).json({ error: 'You are not a participant of this chat' });
    }

    const messages = await prisma.chatMessage.findMany({
      where: {
        chatId: id,
        deletedAt: null,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      include: {
        sender: {
          select: { id: true, name: true, profilePicture: true },
        },
        receipts: {
          include: {
            user: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // Fetch one extra to check if there are more
    });

    const hasMore = messages.length > limit;
    const items = hasMore ? messages.slice(0, -1) : messages;
    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

    res.json({
      messages: items.reverse(), // Return in chronological order
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

/**
 * GET /api/chats/online-users - Get online status for users
 */
router.get('/online-users', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Get all users from chats this user participates in
    const participations = await prisma.chatParticipant.findMany({
      where: { userId, leftAt: null },
      select: { chatId: true },
    });

    const chatIds = participations.map(p => p.chatId);

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
    const onlineMap = await getOnlineUsers(userIds);

    // Get presence details
    const presences = await prisma.userPresence.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, isOnline: true, lastSeenAt: true },
    });

    const presenceMap = new Map(presences.map(p => [p.userId, p]));

    const users = userIds.map(id => ({
      userId: id,
      isOnline: onlineMap.get(id) || false,
      lastSeenAt: presenceMap.get(id)?.lastSeenAt || null,
    }));

    res.json({ users });
  } catch (error) {
    console.error('Get online users error:', error);
    res.status(500).json({ error: 'Failed to get online users' });
  }
});

export default router;
