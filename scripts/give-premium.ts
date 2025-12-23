import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Find demo user
    const user = await prisma.user.findFirst({
        where: { email: 'demo@example.com' }
    });

    if (!user) {
        console.log('Demo user not found, creating one...');
        return;
    }

    console.log('Found user:', user.id, user.email);

    // Create or update subscription
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 1); // 1 year from now

    const subscription = await prisma.subscription.upsert({
        where: { userId: user.id },
        update: {
            plan: 'yearly',
            status: 'active',
            provider: 'mock',
            currentPeriodEnd: endDate,
            cancelAtPeriodEnd: false,
        },
        create: {
            userId: user.id,
            plan: 'yearly',
            status: 'active',
            provider: 'mock',
            currentPeriodStart: new Date(),
            currentPeriodEnd: endDate,
            cancelAtPeriodEnd: false,
        },
    });

    console.log('✅ Premium subscription created for demo@example.com!');
    console.log('Plan:', subscription.plan);
    console.log('Status:', subscription.status);
    console.log('Valid until:', subscription.currentPeriodEnd);
}

main()
    .then(() => prisma.$disconnect())
    .catch(e => { console.error(e); prisma.$disconnect(); });
