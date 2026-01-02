/**
 * Database Migration Script
 * 
 * This script helps migrate data from an old database to a new one.
 * 
 * Usage:
 * 1. Set OLD_DATABASE_URL in your .env file (temporarily)
 * 2. Run: tsx scripts/migrate-database.ts
 * 3. The script will export data from old DB and import to new DB
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const oldDb = new PrismaClient({
  datasources: {
    db: {
      url: process.env.OLD_DATABASE_URL,
    },
  },
});

const newDb = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

async function migratePitchCountLimits() {
  console.log('📊 Migrating Pitch Count Limits...');
  const limits = await oldDb.pitchCountLimit.findMany();
  console.log(`Found ${limits.length} pitch count limits`);

  for (const limit of limits) {
    try {
      await newDb.pitchCountLimit.upsert({
        where: { id: limit.id },
        update: {
          minAge: limit.minAge,
          maxAge: limit.maxAge,
          sessionType: limit.sessionType,
          maxPitches: limit.maxPitches,
          warningThreshold: limit.warningThreshold,
          restDaysAfter: limit.restDaysAfter,
          isActive: limit.isActive,
          notes: limit.notes,
        },
        create: {
          id: limit.id,
          minAge: limit.minAge,
          maxAge: limit.maxAge,
          sessionType: limit.sessionType,
          maxPitches: limit.maxPitches,
          warningThreshold: limit.warningThreshold,
          restDaysAfter: limit.restDaysAfter,
          isActive: limit.isActive,
          notes: limit.notes,
          createdAt: limit.createdAt,
          updatedAt: limit.updatedAt,
        },
      });
      console.log(`  ✅ Migrated limit: ${limit.minAge}-${limit.maxAge} ${limit.sessionType}`);
    } catch (error) {
      console.error(`  ❌ Failed to migrate limit ${limit.id}:`, error);
    }
  }
}

async function migrateRestDayGuidelines() {
  console.log('📊 Migrating Rest Day Guidelines...');
  const guidelines = await oldDb.restDayGuideline.findMany();
  console.log(`Found ${guidelines.length} rest day guidelines`);

  for (const guideline of guidelines) {
    try {
      await newDb.restDayGuideline.upsert({
        where: { id: guideline.id },
        update: {
          minAge: guideline.minAge,
          maxAge: guideline.maxAge,
          pitchCountMin: guideline.pitchCountMin,
          pitchCountMax: guideline.pitchCountMax,
          restDays: guideline.restDays,
          isActive: guideline.isActive,
          notes: guideline.notes,
        },
        create: {
          id: guideline.id,
          minAge: guideline.minAge,
          maxAge: guideline.maxAge,
          pitchCountMin: guideline.pitchCountMin,
          pitchCountMax: guideline.pitchCountMax,
          restDays: guideline.restDays,
          isActive: guideline.isActive,
          notes: guideline.notes,
          createdAt: guideline.createdAt,
          updatedAt: guideline.updatedAt,
        },
      });
      console.log(`  ✅ Migrated guideline: ${guideline.minAge}-${guideline.maxAge}`);
    } catch (error) {
      console.error(`  ❌ Failed to migrate guideline ${guideline.id}:`, error);
    }
  }
}

async function migrateCourses() {
  console.log('📚 Migrating Courses...');
  const courses = await oldDb.course.findMany({
    include: { lessons: true },
  });
  console.log(`Found ${courses.length} courses`);

  for (const course of courses) {
    try {
      // Migrate course
      await newDb.course.upsert({
        where: { id: course.id },
        update: {
          title: course.title,
          description: course.description,
          thumbnailUrl: course.thumbnailUrl,
          price: course.price,
          isPublished: course.isPublished,
        },
        create: {
          id: course.id,
          title: course.title,
          description: course.description,
          thumbnailUrl: course.thumbnailUrl,
          price: course.price,
          isPublished: course.isPublished,
          createdAt: course.createdAt,
          updatedAt: course.updatedAt,
        },
      });

      // Migrate lessons
      for (const lesson of course.lessons) {
        await newDb.lesson.upsert({
          where: { id: lesson.id },
          update: {
            title: lesson.title,
            description: lesson.description,
            videoUrl: lesson.videoUrl,
            duration: lesson.duration,
            order: lesson.order,
            isFree: lesson.isFree,
          },
          create: {
            id: lesson.id,
            courseId: course.id,
            title: lesson.title,
            description: lesson.description,
            videoUrl: lesson.videoUrl,
            duration: lesson.duration,
            order: lesson.order,
            isFree: lesson.isFree,
            createdAt: lesson.createdAt,
            updatedAt: lesson.updatedAt,
          },
        });
      }

      console.log(`  ✅ Migrated course: ${course.title} (${course.lessons.length} lessons)`);
    } catch (error) {
      console.error(`  ❌ Failed to migrate course ${course.id}:`, error);
    }
  }
}

async function migrateUsers() {
  console.log('👥 Migrating Users (excluding seeded users)...');
  const seededEmails = [
    'admin@pitchcoach.ai',
    'demo@example.com',
    'nathan@nathanthrower.com',
    'subscriber@example.com',
  ];

  const users = await oldDb.user.findMany({
    where: {
      email: {
        notIn: seededEmails,
      },
    },
    include: {
      subscription: true,
      referralCode: true,
    },
  });

  console.log(`Found ${users.length} custom users to migrate`);

  for (const user of users) {
    try {
      await newDb.user.upsert({
        where: { email: user.email },
        update: {
          name: user.name,
          firstName: user.firstName,
          lastName: user.lastName,
          age: user.age,
          language: user.language,
          role: user.role,
          password: user.password, // Keep existing password
        },
        create: {
          id: user.id,
          email: user.email,
          password: user.password,
          name: user.name,
          firstName: user.firstName,
          lastName: user.lastName,
          age: user.age,
          language: user.language,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      });

      // Migrate subscription if exists
      if (user.subscription) {
        await newDb.subscription.upsert({
          where: { userId: user.id },
          update: {
            plan: user.subscription.plan,
            status: user.subscription.status,
            provider: user.subscription.provider,
            providerSubId: user.subscription.providerSubId,
            currentPeriodStart: user.subscription.currentPeriodStart,
            currentPeriodEnd: user.subscription.currentPeriodEnd,
            cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
          },
          create: {
            id: user.subscription.id,
            userId: user.id,
            plan: user.subscription.plan,
            status: user.subscription.status,
            provider: user.subscription.provider,
            providerSubId: user.subscription.providerSubId,
            currentPeriodStart: user.subscription.currentPeriodStart,
            currentPeriodEnd: user.subscription.currentPeriodEnd,
            cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
            createdAt: user.subscription.createdAt,
            updatedAt: user.subscription.updatedAt,
          },
        });
      }

      console.log(`  ✅ Migrated user: ${user.email}`);
    } catch (error) {
      console.error(`  ❌ Failed to migrate user ${user.email}:`, error);
    }
  }
}

async function main() {
  if (!process.env.OLD_DATABASE_URL) {
    console.error('❌ OLD_DATABASE_URL is not set in .env file');
    console.log('\nTo migrate data:');
    console.log('1. Add OLD_DATABASE_URL="your-old-database-url" to your .env file');
    console.log('2. Make sure DATABASE_URL points to your new Railway database');
    console.log('3. Run: tsx scripts/migrate-database.ts');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set in .env file');
    process.exit(1);
  }

  console.log('🚀 Starting database migration...\n');
  console.log('Old DB:', process.env.OLD_DATABASE_URL.replace(/:[^:@]+@/, ':****@'));
  console.log('New DB:', process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@'));
  console.log('');

  try {
    // Test connections
    await oldDb.$connect();
    console.log('✅ Connected to old database');
    await newDb.$connect();
    console.log('✅ Connected to new database\n');

    // Migrate data
    await migratePitchCountLimits();
    await migrateRestDayGuidelines();
    await migrateCourses();
    await migrateUsers();

    console.log('\n🎉 Migration complete!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  }
}

main();

