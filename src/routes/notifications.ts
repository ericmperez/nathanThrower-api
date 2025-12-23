import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// =================================================================
// PUSH NOTIFICATION SERVICE
// =================================================================

interface ExpoPushMessage {
    to: string;
    title: string;
    body: string;
    data?: Record<string, any>;
    sound?: 'default' | null;
    badge?: number;
    channelId?: string;
    priority?: 'default' | 'normal' | 'high';
}

// Send push notification via Expo
async function sendPushNotification(message: ExpoPushMessage): Promise<boolean> {
    try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Accept-encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        });

        const result = await response.json();
        console.log('Push notification sent:', result);
        return true;
    } catch (error) {
        console.error('Failed to send push notification:', error);
        return false;
    }
}

// Send push to multiple tokens
async function sendPushNotifications(messages: ExpoPushMessage[]): Promise<void> {
    // Expo recommends sending in batches of 100
    const batchSize = 100;
    for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);
        await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Accept-encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(batch),
        });
    }
}

// Send notification to all of a user's devices
async function sendToUser(userId: string, title: string, body: string, data?: Record<string, any>): Promise<void> {
    const tokens = await prisma.pushToken.findMany({
        where: { userId, isActive: true },
    });

    if (tokens.length === 0) return;

    const messages: ExpoPushMessage[] = tokens.map(t => ({
        to: t.token,
        title,
        body,
        data,
        sound: 'default',
    }));

    await sendPushNotifications(messages);
}

// =================================================================
// ROUTES
// =================================================================

// POST /api/notifications/token - Register push token
router.post('/token', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId!;
        const { token, deviceId, platform } = req.body;

        if (!token || !token.startsWith('ExponentPushToken[')) {
            return res.status(400).json({ error: 'Invalid Expo push token' });
        }

        // Upsert the push token
        await prisma.pushToken.upsert({
            where: { token },
            update: {
                userId,
                deviceId: deviceId || null,
                platform: platform || 'ios',
                isActive: true,
                updatedAt: new Date(),
            },
            create: {
                userId,
                token,
                deviceId: deviceId || null,
                platform: platform || 'ios',
            },
        });

        console.log(`📱 Push token registered for user ${userId}: ${token.slice(0, 30)}...`);

        res.json({
            success: true,
            message: 'Push token registered',
        });
    } catch (error) {
        console.error('Register push token error:', error);
        res.status(500).json({ error: 'Failed to register push token' });
    }
});

// DELETE /api/notifications/token - Unregister push token
router.delete('/token', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Token required' });
        }

        await prisma.pushToken.updateMany({
            where: { token },
            data: { isActive: false },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Unregister push token error:', error);
        res.status(500).json({ error: 'Failed to unregister push token' });
    }
});

// POST /api/notifications/test - Send test notification (dev only)
router.post('/test', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId!;
        const { title, body } = req.body;

        await sendToUser(userId, title || 'Test Notification', body || 'This is a test push notification!', {
            screen: 'Home',
        });

        res.json({ success: true, message: 'Test notification sent' });
    } catch (error) {
        console.error('Test notification error:', error);
        res.status(500).json({ error: 'Failed to send test notification' });
    }
});

// =================================================================
// NOTIFICATION HELPER FUNCTIONS (for internal use)
// =================================================================

export async function notifyAnalysisComplete(
    userId: string,
    analysisId: string,
    status: 'completed' | 'failed'
): Promise<void> {
    await sendToUser(
        userId,
        status === 'completed' ? '✅ Analysis Complete!' : '❌ Analysis Failed',
        status === 'completed'
            ? 'Your pitching analysis is ready. Tap to see your results!'
            : 'There was an issue analyzing your video. Please try again.',
        { screen: 'AnalysisDetail', analysisId }
    );
}

export async function notifyNewMessage(
    userId: string,
    senderName: string
): Promise<void> {
    await sendToUser(
        userId,
        '💬 New Message',
        `${senderName} sent you a message`,
        { screen: 'Messages' }
    );
}

export async function notifyReferralActivated(
    userId: string,
    referredName: string
): Promise<void> {
    await sendToUser(
        userId,
        '🎉 Referral Activated!',
        `${referredName} just subscribed! You earned a reward.`,
        { screen: 'Referrals' }
    );
}

export async function notifySubscriptionExpiring(
    userId: string,
    daysLeft: number
): Promise<void> {
    await sendToUser(
        userId,
        '⏰ Subscription Expiring Soon',
        `Your subscription expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}. Renew to keep your access!`,
        { screen: 'Subscription' }
    );
}

export { sendPushNotification, sendPushNotifications, sendToUser };
export default router;
