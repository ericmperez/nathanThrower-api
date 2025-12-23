import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const router = Router();
const prisma = new PrismaClient();

// =================================================================
// STRIPE WEBHOOK (placeholder)
// =================================================================
router.post('/stripe', async (req, res, next) => {
  try {
    // TODO: Implement Stripe webhook handling
    console.log('Stripe webhook received:', req.body);
    res.json({ received: true });
  } catch (error) {
    next(error);
  }
});

// =================================================================
// REVENUECAT WEBHOOK
// =================================================================
// Documentation: https://www.revenuecat.com/docs/integrations/webhooks

interface RevenueCatWebhookEvent {
  api_version: string;
  event: {
    id: string;
    type: string;
    app_id: string;
    event_timestamp_ms: number;
    product_id: string;
    period_type: string;
    purchased_at_ms: number;
    expiration_at_ms: number;
    environment: string;
    entitlement_id: string;
    entitlement_ids: string[];
    presented_offering_id: string;
    transaction_id: string;
    original_transaction_id: string;
    is_family_share: boolean;
    country_code: string;
    app_user_id: string;
    aliases: string[];
    original_app_user_id: string;
    currency: string;
    price: number;
    price_in_purchased_currency: number;
    subscriber_attributes: {
      [key: string]: {
        value: string;
        updated_at_ms: number;
      };
    };
    store: string;
    takehome_percentage: number;
    offer_code: string | null;
    tax_percentage: number;
    commission_percentage: number;
    renewal_number: number;
  };
}

// Verify RevenueCat webhook signature
function verifyRevenueCatSignature(payload: string, signature: string, secret: string): boolean {
  if (!secret) return true; // Skip verification if no secret configured

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Map product ID to plan type
function getSubscriptionPlan(productId: string): { plan: string; tier: string } {
  const mapping: { [key: string]: { plan: string; tier: string } } = {
    'pro_monthly': { plan: 'monthly', tier: 'pro' },
    'pro_yearly': { plan: 'yearly', tier: 'pro' },
    'elite_monthly': { plan: 'monthly', tier: 'elite' },
    'elite_yearly': { plan: 'yearly', tier: 'elite' },
  };
  return mapping[productId] || { plan: 'monthly', tier: 'pro' };
}

router.post('/revenuecat', async (req: Request, res: Response) => {
  try {
    const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
    const signature = req.headers['x-revenuecat-signature'] as string;

    // Verify signature if secret is configured
    if (webhookSecret && signature) {
      const rawBody = JSON.stringify(req.body);
      if (!verifyRevenueCatSignature(rawBody, signature, webhookSecret)) {
        console.error('RevenueCat webhook signature verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const event = req.body as RevenueCatWebhookEvent;
    const eventType = event.event?.type;
    const appUserId = event.event?.app_user_id;

    console.log(`📱 RevenueCat webhook: ${eventType} for user ${appUserId}`);

    switch (eventType) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
        await handleNewSubscription(event.event);
        break;

      case 'CANCELLATION':
        await handleCancellation(event.event);
        break;

      case 'EXPIRATION':
        await handleExpiration(event.event);
        break;

      case 'BILLING_ISSUE':
        await handleBillingIssue(event.event);
        break;

      case 'SUBSCRIBER_ALIAS':
        // User aliases updated, can be ignored
        break;

      default:
        console.log(`Unhandled RevenueCat event type: ${eventType}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('RevenueCat webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Handle new subscription or renewal
async function handleNewSubscription(event: RevenueCatWebhookEvent['event']) {
  const userId = event.app_user_id;
  const productId = event.product_id;
  const expiresAt = new Date(event.expiration_at_ms);
  const purchasedAt = new Date(event.purchased_at_ms);
  const { plan, tier } = getSubscriptionPlan(productId);

  console.log(`🎉 New/Renewed subscription: ${tier} ${plan} for user ${userId}`);

  // Find user by ID (RevenueCat app_user_id should match our user ID)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { referredBy: true },
  });

  if (!user) {
    console.error(`User not found: ${userId}`);
    // Try finding by email if stored in subscriber attributes
    const email = event.subscriber_attributes?.['$email']?.value;
    if (email) {
      const userByEmail = await prisma.user.findUnique({
        where: { email },
        include: { referredBy: true },
      });
      if (userByEmail) {
        await processSubscription(userByEmail, event, plan, tier, purchasedAt, expiresAt);
      }
    }
    return;
  }

  await processSubscription(user, event, plan, tier, purchasedAt, expiresAt);
}

async function processSubscription(
  user: any,
  event: RevenueCatWebhookEvent['event'],
  plan: string,
  tier: string,
  purchasedAt: Date,
  expiresAt: Date
) {
  // Update or create subscription
  await prisma.subscription.upsert({
    where: { userId: user.id },
    update: {
      plan: `${tier}_${plan}`,
      status: 'active',
      provider: event.store || 'apple',
      providerSubId: event.original_transaction_id,
      currentPeriodStart: purchasedAt,
      currentPeriodEnd: expiresAt,
      cancelAtPeriodEnd: false,
    },
    create: {
      userId: user.id,
      plan: `${tier}_${plan}`,
      status: 'active',
      provider: event.store || 'apple',
      providerSubId: event.original_transaction_id,
      currentPeriodStart: purchasedAt,
      currentPeriodEnd: expiresAt,
    },
  });

  // Check if this is a first-time purchase and user was referred
  if (event.type === 'INITIAL_PURCHASE' && user.referredBy) {
    await activateReferral(user.referredBy, event);
  }

  console.log(`✅ Subscription updated for user ${user.id}: ${tier}_${plan}`);
}

// Activate referral when referred user makes first purchase
async function activateReferral(referral: any, event: RevenueCatWebhookEvent['event']) {
  if (referral.status === 'active') {
    console.log('Referral already activated');
    return;
  }

  // Calculate commission (20% of purchase price, accounting for Apple's cut)
  // RevenueCat provides takehome_percentage which is revenue after store cut
  const takehomePercentage = event.takehome_percentage || 0.70; // Default 70% after Apple cut
  const price = event.price || 0;
  const netRevenue = price * takehomePercentage;
  const commissionRate = referral.commissionRate || 0.20;
  const commissionAmount = Math.round(netRevenue * commissionRate * 100); // Convert to cents

  console.log(`💰 Activating referral: ${referral.id}, commission: ${commissionAmount} cents`);

  await prisma.$transaction([
    // Update referral status
    prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: 'active',
        freeMonthsGiven: { increment: 1 },
      },
    }),
    // Create commission record
    prisma.commission.create({
      data: {
        referralId: referral.id,
        amount: commissionAmount,
        currency: event.currency || 'USD',
        status: 'pending',
        description: `${event.product_id} - ${new Date(event.purchased_at_ms).toLocaleDateString()}`,
      },
    }),
  ]);

  console.log(`✅ Referral activated: ${referral.id}`);
}

// Handle subscription cancellation
async function handleCancellation(event: RevenueCatWebhookEvent['event']) {
  const userId = event.app_user_id;

  console.log(`🚫 Subscription cancelled for user ${userId}`);

  await prisma.subscription.updateMany({
    where: {
      userId,
      providerSubId: event.original_transaction_id,
    },
    data: {
      cancelAtPeriodEnd: true,
    },
  });
}

// Handle subscription expiration
async function handleExpiration(event: RevenueCatWebhookEvent['event']) {
  const userId = event.app_user_id;

  console.log(`⏰ Subscription expired for user ${userId}`);

  await prisma.subscription.updateMany({
    where: {
      userId,
      providerSubId: event.original_transaction_id,
    },
    data: {
      status: 'expired',
    },
  });

  // Update referral status if user was referred
  await prisma.referral.updateMany({
    where: { referredId: userId },
    data: { status: 'cancelled' },
  });
}

// Handle billing issues
async function handleBillingIssue(event: RevenueCatWebhookEvent['event']) {
  const userId = event.app_user_id;

  console.log(`⚠️ Billing issue for user ${userId}`);

  await prisma.subscription.updateMany({
    where: {
      userId,
      providerSubId: event.original_transaction_id,
    },
    data: {
      status: 'past_due',
    },
  });
}

export default router;
