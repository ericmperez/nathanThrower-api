import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('🔐 Creating Nathan Thrower admin user...');

  const email = 'nathan@nathanthrower.com';
  const password = process.env.NATHAN_PASSWORD || 'nathan1234';
  const hashedPassword = await bcrypt.hash(password, 12);

  try {
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        password: hashedPassword,
        role: 'nathan',
        name: 'Nathan Thrower',
      },
      create: {
        email,
        password: hashedPassword,
        name: 'Nathan Thrower',
        role: 'nathan',
      },
    });

    console.log('✅ Nathan Thrower user created/updated:', user.email);
    console.log('📧 Email:', email);
    console.log('🔑 Password:', password);
    console.log('👤 Role:', user.role);
  } catch (error) {
    console.error('❌ Error creating user:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();


