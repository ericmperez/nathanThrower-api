import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'nathan@nathanthrower.com';
  
  console.log('🔍 Checking for user:', email);
  
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        password: true, // We need to see the hash
      },
    });

    if (!user) {
      console.log('❌ User NOT found in database!');
      console.log('📝 You need to create the user first.');
      return;
    }

    console.log('✅ User found!');
    console.log('📧 Email:', user.email);
    console.log('👤 Name:', user.name);
    console.log('🔑 Role:', user.role);
    console.log('🆔 ID:', user.id);
    console.log('🔐 Password hash:', user.password.substring(0, 20) + '...');

    // Test password
    const testPassword = 'nathan1234';
    const isValid = await bcrypt.compare(testPassword, user.password);
    
    console.log('\n🧪 Testing password "nathan1234":', isValid ? '✅ CORRECT' : '❌ INCORRECT');
    
    if (!isValid) {
      console.log('\n⚠️  Password mismatch!');
      console.log('💡 The password hash in the database does not match "nathan1234"');
      console.log('💡 You may need to update the password hash or use a different password');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();


