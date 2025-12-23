import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin1234', 10);
  const admin = await prisma.user.upsert({
    where: { email: process.env.ADMIN_EMAIL || 'admin@pitchcoach.ai' },
    update: {},
    create: {
      email: process.env.ADMIN_EMAIL || 'admin@pitchcoach.ai',
      password: adminPassword,
      name: 'Admin User',
      role: 'admin',
    },
  });
  console.log('✅ Admin user created:', admin.email);

  // Create demo user
  const demoPassword = await bcrypt.hash('demo1234', 10);
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: {
      email: 'demo@example.com',
      password: demoPassword,
      name: 'Demo Pitcher',
      role: 'user',
    },
  });
  console.log('✅ Demo user created:', demoUser.email);

  // Create Nathan Thrower (the coach)
  const nathanPassword = await bcrypt.hash(process.env.NATHAN_PASSWORD || 'nathan1234', 12);
  const nathan = await prisma.user.upsert({
    where: { email: 'nathan@nathanthrower.com' },
    update: {},
    create: {
      email: 'nathan@nathanthrower.com',
      password: nathanPassword,
      name: 'Nathan Thrower',
      role: 'nathan',
    },
  });
  console.log('✅ Nathan Thrower account created:', nathan.email);

  // Create a test subscriber (for testing messaging)
  const subscriberPassword = await bcrypt.hash('subscriber1234', 10);
  const subscriber = await prisma.user.upsert({
    where: { email: 'subscriber@example.com' },
    update: {},
    create: {
      email: 'subscriber@example.com',
      password: subscriberPassword,
      name: 'Pro Subscriber',
      role: 'user',
    },
  });

  // Give subscriber an active subscription
  const subscriptionEnd = new Date();
  subscriptionEnd.setDate(subscriptionEnd.getDate() + 30); // 30 days from now

  await prisma.subscription.upsert({
    where: { userId: subscriber.id },
    update: {
      status: 'active',
      currentPeriodEnd: subscriptionEnd,
    },
    create: {
      userId: subscriber.id,
      plan: 'monthly',
      status: 'active',
      provider: 'mock',
      currentPeriodStart: new Date(),
      currentPeriodEnd: subscriptionEnd,
    },
  });
  console.log('✅ Test subscriber created:', subscriber.email, '(with active subscription)');

  // Create courses
  const course1 = await prisma.course.upsert({
    where: { id: 'course-1' },
    update: {},
    create: {
      id: 'course-1',
      title: 'Velocity Development Program',
      description: 'A comprehensive 12-week program designed to safely increase fastball velocity through proven biomechanical principles and progressive training.',
      thumbnailUrl: 'https://images.unsplash.com/photo-1566577134770-3d85bb3a9cc4?w=800',
      price: 9900, // $99.00
      isPublished: true,
    },
  });

  await prisma.lesson.createMany({
    data: [
      {
        courseId: course1.id,
        title: 'Welcome & Program Overview',
        description: 'Introduction to the velocity development program and what to expect over the next 12 weeks.',
        duration: 420,
        order: 0,
        isFree: true,
      },
      {
        courseId: course1.id,
        title: 'Biomechanics of Velocity',
        description: 'Understanding the kinetic chain and key positions that generate power.',
        duration: 1200,
        order: 1,
        isFree: true,
      },
      {
        courseId: course1.id,
        title: 'Lower Body Power Development',
        description: 'Exercises and drills to build explosive lower body strength.',
        duration: 1800,
        order: 2,
        isFree: false,
      },
      {
        courseId: course1.id,
        title: 'Core & Rotational Training',
        description: 'Building the foundation for efficient energy transfer.',
        duration: 1500,
        order: 3,
        isFree: false,
      },
      {
        courseId: course1.id,
        title: 'Arm Care & Injury Prevention',
        description: 'Essential routines to keep your arm healthy while throwing harder.',
        duration: 2100,
        order: 4,
        isFree: false,
      },
    ],
    skipDuplicates: true,
  });

  const course2 = await prisma.course.upsert({
    where: { id: 'course-2' },
    update: {},
    create: {
      id: 'course-2',
      title: 'Command Mastery',
      description: 'Learn to locate your pitches with precision. Covers mental approach, mechanical consistency, and practice strategies.',
      thumbnailUrl: 'https://images.unsplash.com/photo-1529255484408-0820b92fc004?w=800',
      price: 7900, // $79.00
      isPublished: true,
    },
  });

  await prisma.lesson.createMany({
    data: [
      {
        courseId: course2.id,
        title: 'The Mental Game of Command',
        description: 'Developing focus and routine for consistent execution.',
        duration: 900,
        order: 0,
        isFree: true,
      },
      {
        courseId: course2.id,
        title: 'Release Point Consistency',
        description: 'Drills and feedback mechanisms to groove your release.',
        duration: 1400,
        order: 1,
        isFree: false,
      },
      {
        courseId: course2.id,
        title: 'Advanced Bullpen Strategies',
        description: 'How to structure bullpens for maximum command improvement.',
        duration: 1600,
        order: 2,
        isFree: false,
      },
    ],
    skipDuplicates: true,
  });

  const course3 = await prisma.course.upsert({
    where: { id: 'course-3' },
    update: {},
    create: {
      id: 'course-3',
      title: 'Breaking Ball Development',
      description: 'Master your curveball and slider with proper mechanics and training progressions.',
      thumbnailUrl: 'https://images.unsplash.com/photo-1575361204480-aadea25e6e68?w=800',
      price: 6900, // $69.00
      isPublished: true,
    },
  });

  await prisma.lesson.createMany({
    data: [
      {
        courseId: course3.id,
        title: 'Curveball Fundamentals',
        description: 'Grip, release, and arm action for an effective curveball.',
        duration: 1100,
        order: 0,
        isFree: true,
      },
      {
        courseId: course3.id,
        title: 'Slider Mechanics',
        description: 'Building a tight, late-breaking slider.',
        duration: 1200,
        order: 1,
        isFree: false,
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Courses and lessons created');

  // Create drill library
  await prisma.drill.createMany({
    data: [
      {
        id: 'stride-extension-drill',
        title: 'Stride Extension Drill',
        description: 'Practice extending your stride to maximize power transfer. Use markers to track progress.',
        category: 'mechanics',
        tags: ['stride', 'lower-body', 'power'],
      },
      {
        id: 'long-toss',
        title: 'Long Toss',
        description: 'Progressive long toss program to build arm strength and extension.',
        category: 'throwing',
        tags: ['arm-strength', 'conditioning'],
      },
      {
        id: 'rocker-drill',
        title: 'Rocker Drill',
        description: 'Hip-shoulder separation drill from rocker position.',
        category: 'mechanics',
        tags: ['separation', 'timing'],
      },
      {
        id: 'med-ball-scoop',
        title: 'Medicine Ball Scoop Throw',
        description: 'Explosive rotational power development with med ball.',
        category: 'strength',
        tags: ['rotation', 'power', 'core'],
      },
      {
        id: 'lead-leg-stabilization',
        title: 'Lead Leg Stabilization',
        description: 'Strengthen lead leg to create firm block at landing.',
        category: 'strength',
        tags: ['lower-body', 'stability'],
      },
      {
        id: 'single-leg-squat',
        title: 'Single Leg Squat',
        description: 'Build unilateral leg strength and balance.',
        category: 'strength',
        tags: ['lower-body', 'balance'],
      },
      {
        id: 'flat-ground-work',
        title: 'Flat Ground Throwing',
        description: 'Focused flat ground work to groove mechanics.',
        category: 'throwing',
        tags: ['mechanics', 'consistency'],
      },
      {
        id: 'towel-drill',
        title: 'Towel Drill',
        description: 'Arm path and extension drill with towel.',
        category: 'mechanics',
        tags: ['arm-path', 'extension'],
      },
      {
        id: 'balance-drill',
        title: 'Balance Drill',
        description: 'Static balance positions to improve stability.',
        category: 'mechanics',
        tags: ['balance', 'control'],
      },
      {
        id: 'one-leg-catch',
        title: 'One Leg Catch Play',
        description: 'Playing catch on one leg to improve balance and control.',
        category: 'throwing',
        tags: ['balance', 'control'],
      },
      {
        id: 'recovery-routine',
        title: 'Post-Throwing Recovery',
        description: 'Essential arm care and recovery protocol.',
        category: 'recovery',
        tags: ['arm-care', 'recovery'],
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Drill library created');
  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
