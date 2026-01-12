import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { broadcastMessageEvent, broadcastConversationUpdate } from '../lib/websocket';
import { generatePresignedViewUrl } from '../lib/s3';

const router = Router();

// Validation schemas - handle video/image fields flexibly
const sendMessageSchema = z.object({
    content: z.string().min(1).max(2000),
    videoUrl: z.preprocess(
        (val) => {
            if (val === '' || val === null || val === undefined) return undefined;
            return val;
        },
        z.string().url().optional()
    ),
    videoKey: z.preprocess(
        (val) => {
            if (val === '' || val === null || val === undefined) return undefined;
            return val;
        },
        z.string().optional()
    ),
    imageUrl: z.preprocess(
        (val) => {
            if (val === '' || val === null || val === undefined) return undefined;
            return val;
        },
        z.string().url().optional()
    ),
    imageKey: z.preprocess(
        (val) => {
            if (val === '' || val === null || val === undefined) return undefined;
            return val;
        },
        z.string().optional()
    ),
}).refine(
    (data) => {
        // Both must be provided together or both must be undefined (for video)
        return (data.videoUrl !== undefined) === (data.videoKey !== undefined);
    },
    {
        message: "Both videoUrl and videoKey must be provided together, or both must be empty",
    }
).refine(
    (data) => {
        // Both must be provided together or both must be undefined (for image)
        return (data.imageUrl !== undefined) === (data.imageKey !== undefined);
    },
    {
        message: "Both imageUrl and imageKey must be provided together, or both must be empty",
    }
);

const reactionSchema = z.object({
    emoji: z.string().min(1).max(10), // Emoji character
});

// In-memory store for typing indicators (simple implementation)
// In production, you'd use Redis or a similar store
const typingIndicators = new Map<string, { isTyping: boolean; lastUpdated: Date }>();
const TYPING_TIMEOUT = 10000; // 10 seconds

// Get Nathan's user ID (the coach account)
const getNathanUserId = async (): Promise<string | null> => {
    const nathan = await prisma.user.findFirst({
        where: { role: 'nathan' },
        select: { id: true },
    });
    return nathan?.id || null;
};

// Check if user has active subscription
const hasActiveSubscription = async (userId: string): Promise<boolean> => {
    const subscription = await prisma.subscription.findUnique({
        where: { userId },
    });

    if (!subscription) return false;
    if (subscription.status !== 'active') return false;
    if (new Date() > subscription.currentPeriodEnd) return false;

    return true;
};

// GET /api/messages - Get conversation with Nathan
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;

        // Check subscription
        const isSubscribed = await hasActiveSubscription(userId);
        if (!isSubscribed) {
            return res.status(403).json({
                error: 'Subscription required',
                code: 'SUBSCRIPTION_REQUIRED',
                message: 'Upgrade to Pro to message Nathan directly'
            });
        }

        const nathanId = await getNathanUserId();
        if (!nathanId) {
            return res.status(503).json({ error: 'Messaging not available' });
        }

        // Get messages between user and Nathan with reactions and bookmarks
        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { senderId: userId, receiverId: nathanId },
                    { senderId: nathanId, receiverId: userId },
                ],
            },
            orderBy: { createdAt: 'asc' },
            include: {
                sender: {
                    select: { id: true, name: true, role: true },
                },
                reactions: {
                    select: { emoji: true, userId: true, createdAt: true },
                },
                bookmarks: {
                    where: { userId },
                    select: { id: true },
                },
            },
        });

        // Generate signed URLs for videos and format response
        const messagesWithSignedUrls = await Promise.all(
            messages.map(async (msg) => {
                let videoUrl = msg.videoUrl;
                if (msg.hasVideo && msg.videoKey) {
                    try {
                        videoUrl = await generatePresignedViewUrl(msg.videoKey, 3600); // 1 hour expiry
                    } catch (error) {
                        console.error('Failed to generate signed URL for video:', error);
                    }
                }
                return {
                    ...msg,
                    videoUrl,
                    isBookmarked: (msg.bookmarks?.length ?? 0) > 0,
                    bookmarks: undefined, // Remove bookmarks array from response
                };
            })
        );

        // Mark unread messages as read
        await prisma.message.updateMany({
            where: {
                senderId: nathanId,
                receiverId: userId,
                isRead: false,
            },
            data: { isRead: true },
        });

        res.json({ messages: messagesWithSignedUrls });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// POST /api/messages - Send a message to Nathan
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;

        // Check subscription
        const isSubscribed = await hasActiveSubscription(userId);
        if (!isSubscribed) {
            return res.status(403).json({
                error: 'Subscription required',
                code: 'SUBSCRIPTION_REQUIRED',
                message: 'Upgrade to Pro to message Nathan directly'
            });
        }

        const nathanId = await getNathanUserId();
        if (!nathanId) {
            return res.status(503).json({ error: 'Messaging not available' });
        }

        const body = sendMessageSchema.parse(req.body);

        const message = await prisma.message.create({
            data: {
                senderId: userId,
                receiverId: nathanId,
                content: body.content,
                videoUrl: (body.videoUrl && body.videoUrl.length > 0) ? body.videoUrl : null,
                videoKey: (body.videoKey && body.videoKey.length > 0) ? body.videoKey : null,
                hasVideo: !!(body.videoUrl && body.videoUrl.length > 0 && body.videoKey && body.videoKey.length > 0),
                imageUrl: (body.imageUrl && body.imageUrl.length > 0) ? body.imageUrl : null,
                imageKey: (body.imageKey && body.imageKey.length > 0) ? body.imageKey : null,
                hasImage: !!(body.imageUrl && body.imageUrl.length > 0 && body.imageKey && body.imageKey.length > 0),
            },
            include: {
                sender: {
                    select: { id: true, name: true, role: true },
                },
            },
        });

        // Broadcast real-time event
        broadcastMessageEvent(message, userId, nathanId).catch(console.error);
        broadcastConversationUpdate(userId);
        broadcastConversationUpdate(nathanId);

        res.status(201).json({ message });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors[0].message });
        }
        console.error('Send message error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
        res.status(500).json({ error: errorMessage });
    }
});

// GET /api/messages/subscription-status - Check subscription status
router.get('/subscription-status', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;

        const subscription = await prisma.subscription.findUnique({
            where: { userId },
        });

        const isActive = subscription
            ? subscription.status === 'active' && new Date() <= subscription.currentPeriodEnd
            : false;

        res.json({
            isSubscribed: isActive,
            subscription: subscription ? {
                plan: subscription.plan,
                status: subscription.status,
                currentPeriodEnd: subscription.currentPeriodEnd,
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            } : null,
        });
    } catch (error) {
        console.error('Subscription status error:', error);
        res.status(500).json({ error: 'Failed to get subscription status' });
    }
});

// GET /api/messages/unread-count - Get unread message count
router.get('/unread-count', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;

        const count = await prisma.message.count({
            where: {
                receiverId: userId,
                isRead: false,
            },
        });

        res.json({ unreadCount: count });
    } catch (error) {
        console.error('Unread count error:', error);
        res.status(500).json({ error: 'Failed to get unread count' });
    }
});

// ===== ADMIN/NATHAN ENDPOINTS =====

// GET /api/messages/conversations - Nathan gets all conversations (admin only)
router.get('/conversations', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const user = req.user!;

        if (user.role !== 'nathan' && user.role !== 'admin') {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Get Nathan's user ID so admins can see messages sent to Nathan
        const nathanId = await getNathanUserId();
        
        // If admin is logged in, include messages to/from both admin and Nathan
        // If Nathan is logged in, just use Nathan's ID
        const targetUserIds = user.role === 'admin' && nathanId && user.userId !== nathanId 
            ? [user.userId, nathanId] 
            : [user.userId];

        // Get all unique users who have messaged Nathan/admin
        const conversations = await prisma.message.findMany({
            where: {
                OR: [
                    { receiverId: { in: targetUserIds } },
                    { senderId: { in: targetUserIds } },
                ],
            },
            select: {
                sender: {
                    select: { id: true, name: true, email: true },
                },
                receiver: {
                    select: { id: true, name: true, email: true },
                },
                createdAt: true,
                content: true,
                isRead: true,
                videoUrl: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        // Group by user and get latest message
        const userMap = new Map<string, any>();

        for (const msg of conversations) {
            // Determine the "other user" (not admin/nathan)
            const isFromTargetUser = targetUserIds.includes(msg.sender.id);
            const otherUser = isFromTargetUser ? msg.receiver : msg.sender;

            // Skip if the other user is also admin/nathan (shouldn't happen, but safety check)
            if (targetUserIds.includes(otherUser.id)) {
                continue;
            }

            if (!userMap.has(otherUser.id)) {
                userMap.set(otherUser.id, {
                    user: otherUser,
                    // If there's a video URL, treat last message as a video
                    lastMessage: msg.videoUrl ? '📹 Video' : msg.content,
                    lastMessageAt: msg.createdAt,
                    unread: 0,
                });
            }

            // Count unread messages FROM this user (not from admin/nathan)
            if (!isFromTargetUser && !msg.isRead) {
                const existing = userMap.get(otherUser.id);
                existing.unread++;
            }
        }

        const conversationList = Array.from(userMap.values())
            .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

        res.json({ conversations: conversationList });
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ error: 'Failed to get conversations' });
    }
});

// GET /api/messages/user/:userId - Nathan gets messages with specific user
router.get('/user/:userId', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const currentUser = req.user!;
        const { userId } = req.params;

        if (currentUser.role !== 'nathan' && currentUser.role !== 'admin') {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { senderId: currentUser.userId, receiverId: userId },
                    { senderId: userId, receiverId: currentUser.userId },
                ],
            },
            orderBy: { createdAt: 'asc' },
            include: {
                sender: {
                    select: { id: true, name: true, role: true },
                },
            },
        });

        // Generate signed URLs for videos (bypasses CORS)
        const messagesWithSignedUrls = await Promise.all(
            messages.map(async (msg) => {
                if (msg.hasVideo && msg.videoKey) {
                    try {
                        const signedUrl = await generatePresignedViewUrl(msg.videoKey, 3600); // 1 hour expiry
                        return {
                            ...msg,
                            videoUrl: signedUrl, // Replace with signed URL
                        };
                    } catch (error) {
                        console.error('Failed to generate signed URL for video:', error);
                        // Return original URL if signing fails
                        return msg;
                    }
                }
                return msg;
            })
        );

        // Mark as read
        await prisma.message.updateMany({
            where: {
                senderId: userId,
                receiverId: currentUser.userId,
                isRead: false,
            },
            data: { isRead: true },
        });

        res.json({ messages: messagesWithSignedUrls });
    } catch (error) {
        console.error('Get user messages error:', error);
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// POST /api/messages/user/:userId - Nathan replies to a user
router.post('/user/:userId', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const currentUser = req.user!;
        const { userId } = req.params;

        if (currentUser.role !== 'nathan' && currentUser.role !== 'admin') {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const body = sendMessageSchema.parse(req.body);

        const message = await prisma.message.create({
            data: {
                senderId: currentUser.userId,
                receiverId: userId,
                content: body.content,
                videoUrl: (body.videoUrl && body.videoUrl.length > 0) ? body.videoUrl : null,
                videoKey: (body.videoKey && body.videoKey.length > 0) ? body.videoKey : null,
                hasVideo: !!(body.videoUrl && body.videoUrl.length > 0 && body.videoKey && body.videoKey.length > 0),
            },
            include: {
                sender: {
                    select: { id: true, name: true, role: true },
                },
            },
        });

        // Broadcast real-time event
        broadcastMessageEvent(message, currentUser.userId, userId).catch(console.error);
        broadcastConversationUpdate(currentUser.userId);
        broadcastConversationUpdate(userId);

        res.status(201).json({ message });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors[0].message });
        }
        console.error('Reply message error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
        res.status(500).json({ error: errorMessage });
    }
});

// ===== NEW FEATURE ENDPOINTS =====

// GET /api/messages/search - Search messages
router.get('/search', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;
        const query = req.query.q as string;

        if (!query || query.trim().length === 0) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const nathanId = await getNathanUserId();
        if (!nathanId) {
            return res.status(503).json({ error: 'Messaging not available' });
        }

        // Search messages between user and Nathan
        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { senderId: userId, receiverId: nathanId },
                    { senderId: nathanId, receiverId: userId },
                ],
                content: {
                    contains: query,
                    mode: 'insensitive',
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: {
                sender: {
                    select: { id: true, name: true, role: true },
                },
                reactions: {
                    select: { emoji: true, userId: true, createdAt: true },
                },
                bookmarks: {
                    where: { userId },
                    select: { id: true },
                },
            },
        });

        const formattedMessages = messages.map((msg) => ({
            ...msg,
            isBookmarked: (msg.bookmarks?.length ?? 0) > 0,
            bookmarks: undefined,
        }));

        res.json({ messages: formattedMessages });
    } catch (error) {
        console.error('Search messages error:', error);
        res.status(500).json({ error: 'Failed to search messages' });
    }
});

// GET /api/messages/bookmarked - Get bookmarked messages
router.get('/bookmarked', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;

        const bookmarks = await prisma.messageBookmark.findMany({
            where: { userId },
            include: {
                message: {
                    include: {
                        sender: {
                            select: { id: true, name: true, role: true },
                        },
                        reactions: {
                            select: { emoji: true, userId: true, createdAt: true },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        const messages = bookmarks.map((b) => ({
            ...b.message,
            isBookmarked: true,
        }));

        res.json({ messages });
    } catch (error) {
        console.error('Get bookmarked messages error:', error);
        res.status(500).json({ error: 'Failed to get bookmarked messages' });
    }
});

// POST /api/messages/:messageId/bookmark - Bookmark a message
router.post('/:messageId/bookmark', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;
        const { messageId } = req.params;

        // Verify the message exists and user has access
        const message = await prisma.message.findFirst({
            where: {
                id: messageId,
                OR: [
                    { senderId: userId },
                    { receiverId: userId },
                ],
            },
        });

        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        // Create bookmark (upsert to handle duplicates)
        await prisma.messageBookmark.upsert({
            where: {
                messageId_userId: {
                    messageId,
                    userId,
                },
            },
            create: {
                messageId,
                userId,
            },
            update: {}, // No update needed, just ensure it exists
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Bookmark message error:', error);
        res.status(500).json({ error: 'Failed to bookmark message' });
    }
});

// DELETE /api/messages/:messageId/bookmark - Remove bookmark from a message
router.delete('/:messageId/bookmark', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;
        const { messageId } = req.params;

        await prisma.messageBookmark.deleteMany({
            where: {
                messageId,
                userId,
            },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Remove bookmark error:', error);
        res.status(500).json({ error: 'Failed to remove bookmark' });
    }
});

// POST /api/messages/:messageId/reaction - Add a reaction to a message
router.post('/:messageId/reaction', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;
        const { messageId } = req.params;
        const { emoji } = reactionSchema.parse(req.body);

        // Verify the message exists and user has access
        const message = await prisma.message.findFirst({
            where: {
                id: messageId,
                OR: [
                    { senderId: userId },
                    { receiverId: userId },
                ],
            },
        });

        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        // Create reaction (upsert to handle duplicates)
        await prisma.messageReaction.upsert({
            where: {
                messageId_userId_emoji: {
                    messageId,
                    userId,
                    emoji,
                },
            },
            create: {
                messageId,
                userId,
                emoji,
            },
            update: {}, // No update needed, just ensure it exists
        });

        // Get updated reactions
        const reactions = await prisma.messageReaction.findMany({
            where: { messageId },
            select: { emoji: true, userId: true, createdAt: true },
        });

        res.json({ success: true, reactions });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors[0].message });
        }
        console.error('Add reaction error:', error);
        res.status(500).json({ error: 'Failed to add reaction' });
    }
});

// DELETE /api/messages/:messageId/reaction - Remove a reaction from a message
router.delete('/:messageId/reaction', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;
        const { messageId } = req.params;
        const { emoji } = reactionSchema.parse(req.body);

        await prisma.messageReaction.deleteMany({
            where: {
                messageId,
                userId,
                emoji,
            },
        });

        // Get updated reactions
        const reactions = await prisma.messageReaction.findMany({
            where: { messageId },
            select: { emoji: true, userId: true, createdAt: true },
        });

        res.json({ success: true, reactions });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors[0].message });
        }
        console.error('Remove reaction error:', error);
        res.status(500).json({ error: 'Failed to remove reaction' });
    }
});

// GET /api/messages/typing - Get typing status (for polling)
router.get('/typing', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;

        // Get Nathan's typing status for this user
        const nathanId = await getNathanUserId();
        if (!nathanId) {
            return res.json({ isTyping: false });
        }

        const key = `${nathanId}-${userId}`; // Nathan typing to this user
        const status = typingIndicators.get(key);

        if (!status) {
            return res.json({ isTyping: false });
        }

        // Check if typing indicator has expired
        const now = new Date();
        if (now.getTime() - status.lastUpdated.getTime() > TYPING_TIMEOUT) {
            typingIndicators.delete(key);
            return res.json({ isTyping: false });
        }

        res.json({ isTyping: status.isTyping });
    } catch (error) {
        console.error('Get typing status error:', error);
        res.json({ isTyping: false });
    }
});

// POST /api/messages/typing - Set typing status (for Nathan/admin)
router.post('/typing', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const currentUser = req.user!;

        // Only Nathan/admin can set typing status
        if (currentUser.role !== 'nathan' && currentUser.role !== 'admin') {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const { userId, isTyping } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const key = `${currentUser.userId}-${userId}`;

        if (isTyping) {
            typingIndicators.set(key, {
                isTyping: true,
                lastUpdated: new Date(),
            });
        } else {
            typingIndicators.delete(key);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Set typing status error:', error);
        res.status(500).json({ error: 'Failed to set typing status' });
    }
});

export default router;
