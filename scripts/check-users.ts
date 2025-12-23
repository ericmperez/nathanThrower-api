import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Checking all users in database...\n');

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      subscription: {
        select: {
          plan: true,
          status: true,
          currentPeriodEnd: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`Total users: ${users.length}\n`);
  
  users.forEach((user, index) => {
    console.log(`${index + 1}. ${user.name} (${user.email})`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Created: ${user.createdAt.toISOString()}`);
    console.log(`   Subscription: ${user.subscription ? `${user.subscription.status} (${user.subscription.plan})` : 'None'}`);
    console.log('');
  });

  const userRoleCount = users.filter(u => u.role === 'user').length;
  console.log(`Users with role "user": ${userRoleCount}`);

  await prisma.$disconnect();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });


