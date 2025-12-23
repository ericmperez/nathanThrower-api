import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { broadcastMessageEvent, broadcastConversationUpdate } from '../lib/websocket';
import { generatePresignedViewUrl } from '../lib/s3';

const router = Router();

// Validation schemas - handle video fields flexibly
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
}).refine(
    (data) => {
        // Both must be provided together or both must be undefined
        return (data.videoUrl !== undefined) === (data.videoKey !== undefined);
    },
    {
        message: "Both videoUrl and videoKey must be provided together, or both must be empty",
    }
);

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

        // Get messages between user and Nathan
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
            && subscription.status === 'active'
            && new Date() <= subscription.currentPeriodEnd;

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

export default router;
