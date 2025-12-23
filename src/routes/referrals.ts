import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import crypto from 'crypto';

const router = Router();
const prisma = new PrismaClient();

// Generate a unique referral code
function generateReferralCode(name: string): string {
    const cleanName = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
    const randomPart = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${cleanName}${randomPart}`;
}

// GET /api/referrals/code - Get or create user's referral code
router.get('/code', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId!;

        // Check if user already has a referral code
        let referralCode = await prisma.referralCode.findUnique({
            where: { userId },
        });

        // If not, create one
        if (!referralCode) {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { name: true },
            });

            // Generate unique code
            let code = generateReferralCode(user?.name || 'USER');
            let attempts = 0;

            // Ensure uniqueness
            while (attempts < 10) {
                const existing = await prisma.referralCode.findUnique({
                    where: { code },
                });
                if (!existing) break;
                code = generateReferralCode(user?.name || 'USER');
                attempts++;
            }

            referralCode = await prisma.referralCode.create({
                data: {
                    userId,
                    code,
                },
            });
        }

        res.json({
            code: referralCode.code,
            isActive: referralCode.isActive,
            createdAt: referralCode.createdAt,
        });
    } catch (error) {
        console.error('Get referral code error:', error);
        res.status(500).json({ error: 'Failed to get referral code' });
    }
});

// GET /api/referrals/stats - Get referral statistics
router.get('/stats', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId!;

        // Get user's referral code
        const referralCode = await prisma.referralCode.findUnique({
            where: { userId },
            include: {
                referrals: {
                    include: {
                        referred: {
                            select: { name: true, createdAt: true },
                        },
                        commissions: true,
                    },
                    orderBy: { createdAt: 'desc' },
                },
            },
        });

        if (!referralCode) {
            return res.json({
                code: null,
                totalReferrals: 0,
                activeReferrals: 0,
                pendingReferrals: 0,
                totalEarnings: 0,
                pendingEarnings: 0,
                freeMonthsEarned: 0,
                referrals: [],
            });
        }

        // Calculate stats
        const referrals = referralCode.referrals;
        const totalReferrals = referrals.length;
        const activeReferrals = referrals.filter(r => r.status === 'active').length;
        const pendingReferrals = referrals.filter(r => r.status === 'pending').length;

        // Calculate earnings
        const allCommissions = referrals.flatMap(r => r.commissions);
        const totalEarnings = allCommissions
            .filter(c => c.status === 'paid')
            .reduce((sum, c) => sum + c.amount, 0);
        const pendingEarnings = allCommissions
            .filter(c => c.status === 'pending' || c.status === 'approved')
            .reduce((sum, c) => sum + c.amount, 0);

        // Calculate free months earned
        const freeMonthsEarned = referrals.reduce((sum, r) => sum + r.freeMonthsGiven, 0);

        // Format referrals for frontend
        const formattedReferrals = referrals.map(r => ({
            id: r.id,
            name: r.referred.name,
            status: r.status,
            date: r.createdAt,
            earnings: r.commissions.reduce((sum, c) => sum + c.amount, 0),
        }));

        res.json({
            code: referralCode.code,
            totalReferrals,
            activeReferrals,
            pendingReferrals,
            totalEarnings,
            pendingEarnings,
            freeMonthsEarned,
            referrals: formattedReferrals,
        });
    } catch (error) {
        console.error('Get referral stats error:', error);
        res.status(500).json({ error: 'Failed to get referral stats' });
    }
});

// POST /api/referrals/validate - Validate a referral code (for registration)
router.post('/validate', async (req: Request, res: Response) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Referral code is required' });
        }

        const referralCode = await prisma.referralCode.findUnique({
            where: { code: code.toUpperCase() },
            include: {
                user: {
                    select: { name: true },
                },
            },
        });

        if (!referralCode || !referralCode.isActive) {
            return res.status(404).json({ error: 'Invalid or inactive referral code' });
        }

        res.json({
            valid: true,
            referrerName: referralCode.user.name,
            code: referralCode.code,
        });
    } catch (error) {
        console.error('Validate referral code error:', error);
        res.status(500).json({ error: 'Failed to validate referral code' });
    }
});

// POST /api/referrals/apply - Apply a referral code to current user
router.post('/apply', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId!;
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Referral code is required' });
        }

        // Check if user was already referred
        const existingReferral = await prisma.referral.findUnique({
            where: { referredId: userId },
        });

        if (existingReferral) {
            return res.status(400).json({ error: 'You have already used a referral code' });
        }

        // Find the referral code
        const referralCode = await prisma.referralCode.findUnique({
            where: { code: code.toUpperCase() },
        });

        if (!referralCode || !referralCode.isActive) {
            return res.status(404).json({ error: 'Invalid or inactive referral code' });
        }

        // Can't refer yourself
        if (referralCode.userId === userId) {
            return res.status(400).json({ error: 'You cannot use your own referral code' });
        }

        // Create the referral
        const referral = await prisma.referral.create({
            data: {
                referralCodeId: referralCode.id,
                referrerId: referralCode.userId,
                referredId: userId,
                status: 'pending', // Will become 'active' when they subscribe
            },
        });

        res.json({
            success: true,
            message: 'Referral code applied! You\'ll both get rewards when you subscribe.',
            referralId: referral.id,
        });
    } catch (error) {
        console.error('Apply referral code error:', error);
        res.status(500).json({ error: 'Failed to apply referral code' });
    }
});

// POST /api/referrals/activate - Called when referred user subscribes (internal/webhook)
router.post('/activate', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const { referredUserId, subscriptionAmount, subscriptionPlan } = req.body;

        // Find the referral for this user
        const referral = await prisma.referral.findUnique({
            where: { referredId: referredUserId },
        });

        if (!referral) {
            return res.status(404).json({ error: 'No referral found for this user' });
        }

        if (referral.status === 'active') {
            return res.status(400).json({ error: 'Referral already activated' });
        }

        // Calculate commission (20% of subscription amount)
        const commissionAmount = Math.round(subscriptionAmount * referral.commissionRate);

        // Update referral status and create commission
        await prisma.$transaction([
            prisma.referral.update({
                where: { id: referral.id },
                data: {
                    status: 'active',
                    freeMonthsGiven: { increment: 1 },
                },
            }),
            prisma.commission.create({
                data: {
                    referralId: referral.id,
                    amount: commissionAmount,
                    status: 'pending',
                    description: `${subscriptionPlan} subscription commission`,
                },
            }),
        ]);

        res.json({
            success: true,
            message: 'Referral activated and commission created',
            commissionAmount,
        });
    } catch (error) {
        console.error('Activate referral error:', error);
        res.status(500).json({ error: 'Failed to activate referral' });
    }
});

// GET /api/referrals/commissions - Get user's commission history
router.get('/commissions', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId!;

        // Get all referrals made by this user
        const referrals = await prisma.referral.findMany({
            where: { referrerId: userId },
            include: {
                commissions: {
                    orderBy: { createdAt: 'desc' },
                },
                referred: {
                    select: { name: true },
                },
            },
        });

        // Flatten commissions with referral info
        const commissions = referrals.flatMap(r =>
            r.commissions.map(c => ({
                id: c.id,
                amount: c.amount,
                currency: c.currency,
                status: c.status,
                description: c.description,
                referredName: r.referred.name,
                createdAt: c.createdAt,
                paidAt: c.paidAt,
            }))
        ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Calculate totals
        const totalEarned = commissions
            .filter(c => c.status === 'paid')
            .reduce((sum, c) => sum + c.amount, 0);
        const pendingAmount = commissions
            .filter(c => c.status === 'pending' || c.status === 'approved')
            .reduce((sum, c) => sum + c.amount, 0);

        res.json({
            commissions,
            totalEarned,
            pendingAmount,
        });
    } catch (error) {
        console.error('Get commissions error:', error);
        res.status(500).json({ error: 'Failed to get commissions' });
    }
});

// PUT /api/referrals/code - Update referral code (custom code)
router.put('/code', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId!;
        const { code } = req.body;

        if (!code || code.length < 4 || code.length > 12) {
            return res.status(400).json({
                error: 'Referral code must be 4-12 characters'
            });
        }

        // Validate code format (alphanumeric only)
        if (!/^[A-Z0-9]+$/i.test(code)) {
            return res.status(400).json({
                error: 'Referral code can only contain letters and numbers'
            });
        }

        const upperCode = code.toUpperCase();

        // Check if code is already taken
        const existing = await prisma.referralCode.findUnique({
            where: { code: upperCode },
        });

        if (existing && existing.userId !== userId) {
            return res.status(400).json({ error: 'This code is already taken' });
        }

        // Update or create the referral code
        const referralCode = await prisma.referralCode.upsert({
            where: { userId },
            update: { code: upperCode },
            create: { userId, code: upperCode },
        });

        res.json({
            success: true,
            code: referralCode.code,
        });
    } catch (error) {
        console.error('Update referral code error:', error);
        res.status(500).json({ error: 'Failed to update referral code' });
    }
});

export default router;
