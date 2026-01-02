import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function cleanupDemoData() {
  console.log('🧹 Cleaning up demo/mockup data from database...\n');

  // Define demo user emails to remove
  const demoEmails = [
    'demo@example.com',
    'subscriber@example.com',
  ];

  // Define demo course IDs to remove
  const demoCourseIds = [
    'course-1',
    'course-2',
    'course-3',
  ];

  // Define demo drill IDs to remove
  const demoDrillIds = [
    'drill-towel',
    'drill-connection',
    'drill-wall',
    'drill-mirror',
    'drill-balance',
  ];

  try {
    // 1. Delete demo analyses
    const deletedAnalyses = await prisma.analysis.deleteMany({
      where: {
        user: {
          email: { in: demoEmails }
        }
      }
    });
    console.log(`✅ Deleted ${deletedAnalyses.count} demo analyses`);

    // 2. Delete demo messages
    const deletedMessages = await prisma.message.deleteMany({
      where: {
        OR: [
          { sender: { email: { in: demoEmails } } },
          { receiver: { email: { in: demoEmails } } },
        ]
      }
    });
    console.log(`✅ Deleted ${deletedMessages.count} demo messages`);

    // 3. Delete demo pitch sessions and pitches
    const demoUsers = await prisma.user.findMany({
      where: { email: { in: demoEmails } },
      select: { id: true }
    });
    const demoUserIds = demoUsers.map(u => u.id);

    if (demoUserIds.length > 0) {
      // Delete pitches first (they reference sessions)
      const deletedPitches = await prisma.pitch.deleteMany({
        where: {
          session: {
            userId: { in: demoUserIds }
          }
        }
      });
      console.log(`✅ Deleted ${deletedPitches.count} demo pitches`);

      const deletedSessions = await prisma.pitchCountSession.deleteMany({
        where: { userId: { in: demoUserIds } }
      });
      console.log(`✅ Deleted ${deletedSessions.count} demo pitch sessions`);
    }

    // 4. Delete demo purchases
    const deletedPurchases = await prisma.purchase.deleteMany({
      where: {
        OR: [
          { user: { email: { in: demoEmails } } },
          { courseId: { in: demoCourseIds } },
        ]
      }
    });
    console.log(`✅ Deleted ${deletedPurchases.count} demo purchases`);

    // 5. Delete demo lesson progress
    const deletedProgress = await prisma.lessonProgress.deleteMany({
      where: {
        OR: [
          { user: { email: { in: demoEmails } } },
          { lesson: { courseId: { in: demoCourseIds } } },
        ]
      }
    });
    console.log(`✅ Deleted ${deletedProgress.count} demo lesson progress records`);

    // 6. Delete demo lessons
    const deletedLessons = await prisma.lesson.deleteMany({
      where: { courseId: { in: demoCourseIds } }
    });
    console.log(`✅ Deleted ${deletedLessons.count} demo lessons`);

    // 7. Delete demo courses
    const deletedCourses = await prisma.course.deleteMany({
      where: { id: { in: demoCourseIds } }
    });
    console.log(`✅ Deleted ${deletedCourses.count} demo courses`);

    // 8. Delete demo drills
    const deletedDrills = await prisma.drill.deleteMany({
      where: { id: { in: demoDrillIds } }
    });
    console.log(`✅ Deleted ${deletedDrills.count} demo drills`);

    // 9. Delete demo subscriptions
    const deletedSubscriptions = await prisma.subscription.deleteMany({
      where: { user: { email: { in: demoEmails } } }
    });
    console.log(`✅ Deleted ${deletedSubscriptions.count} demo subscriptions`);

    // 10. Delete demo refresh tokens
    const deletedTokens = await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: demoEmails } } }
    });
    console.log(`✅ Deleted ${deletedTokens.count} demo refresh tokens`);

    // 11. Delete demo auth events
    const deletedAuthEvents = await prisma.authEvent.deleteMany({
      where: { user: { email: { in: demoEmails } } }
    });
    console.log(`✅ Deleted ${deletedAuthEvents.count} demo auth events`);

    // 12. Finally, delete demo users
    const deletedUsers = await prisma.user.deleteMany({
      where: { email: { in: demoEmails } }
    });
    console.log(`✅ Deleted ${deletedUsers.count} demo users`);

    console.log('\n✨ Demo data cleanup complete!');
    console.log('\n📊 Remaining data summary:');
    
    // Show remaining counts
    const userCount = await prisma.user.count();
    const courseCount = await prisma.course.count();
    const drillCount = await prisma.drill.count();
    const subscriptionCount = await prisma.subscription.count();
    
    console.log(`   Users: ${userCount}`);
    console.log(`   Courses: ${courseCount}`);
    console.log(`   Drills: ${drillCount}`);
    console.log(`   Subscriptions: ${subscriptionCount}`);

  } catch (error) {
    console.error('❌ Error cleaning up demo data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

cleanupDemoData()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
