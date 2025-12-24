/**
 * Test script for Profile Update API
 * Tests the PATCH /auth/profile endpoint
 */

const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:4000/api';

// Test data
const testProfile = {
  firstName: 'John',
  lastName: 'Doe',
  age: 25,
  language: 'en',
  role: 'player',
};

async function testProfileAPI() {
  console.log('🧪 Testing Profile Update API\n');
  console.log(`API URL: ${API_URL}\n`);

  // Step 1: Register a test user
  console.log('1️⃣ Registering test user...');
  let accessToken;
  let userId;

  try {
    const registerResponse = await axios.post(`${API_URL}/auth/register`, {
      email: `test-${Date.now()}@example.com`,
      password: 'test123456',
      name: 'Test User',
    });

    accessToken = registerResponse.data.accessToken;
    userId = registerResponse.data.user.id;
    console.log('✅ User registered successfully');
    console.log(`   User ID: ${userId}`);
    console.log(`   Email: ${registerResponse.data.user.email}\n`);
  } catch (error) {
    console.error('❌ Failed to register user:', error.response?.data || error.message);
    return;
  }

  // Step 2: Get current profile (should not have firstName, lastName, etc.)
  console.log('2️⃣ Getting current profile...');
  try {
    const meResponse = await axios.get(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    console.log('✅ Current profile retrieved:');
    console.log(`   firstName: ${meResponse.data.firstName || 'null'}`);
    console.log(`   lastName: ${meResponse.data.lastName || 'null'}`);
    console.log(`   age: ${meResponse.data.age || 'null'}`);
    console.log(`   language: ${meResponse.data.language || 'null'}`);
    console.log(`   role: ${meResponse.data.role}\n`);
  } catch (error) {
    console.error('❌ Failed to get profile:', error.response?.data || error.message);
    return;
  }

  // Step 3: Update profile with new fields
  console.log('3️⃣ Updating profile...');
  try {
    const updateResponse = await axios.patch(
      `${API_URL}/auth/profile`,
      testProfile,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    console.log('✅ Profile updated successfully:');
    console.log(`   firstName: ${updateResponse.data.firstName}`);
    console.log(`   lastName: ${updateResponse.data.lastName}`);
    console.log(`   age: ${updateResponse.data.age}`);
    console.log(`   language: ${updateResponse.data.language}`);
    console.log(`   role: ${updateResponse.data.role}\n`);

    // Verify all fields match
    const allMatch =
      updateResponse.data.firstName === testProfile.firstName &&
      updateResponse.data.lastName === testProfile.lastName &&
      updateResponse.data.age === testProfile.age &&
      updateResponse.data.language === testProfile.language &&
      updateResponse.data.role === testProfile.role;

    if (allMatch) {
      console.log('✅ All profile fields match expected values!\n');
    } else {
      console.log('⚠️  Some fields do not match expected values\n');
    }
  } catch (error) {
    console.error('❌ Failed to update profile:', error.response?.data || error.message);
    return;
  }

  // Step 4: Verify profile was saved by getting it again
  console.log('4️⃣ Verifying profile was saved...');
  try {
    const verifyResponse = await axios.get(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    console.log('✅ Profile retrieved from database:');
    console.log(`   firstName: ${verifyResponse.data.firstName}`);
    console.log(`   lastName: ${verifyResponse.data.lastName}`);
    console.log(`   age: ${verifyResponse.data.age}`);
    console.log(`   language: ${verifyResponse.data.language}`);
    console.log(`   role: ${verifyResponse.data.role}\n`);

    // Verify persistence
    const persisted =
      verifyResponse.data.firstName === testProfile.firstName &&
      verifyResponse.data.lastName === testProfile.lastName &&
      verifyResponse.data.age === testProfile.age &&
      verifyResponse.data.language === testProfile.language &&
      verifyResponse.data.role === testProfile.role;

    if (persisted) {
      console.log('✅ Profile data persisted correctly in database!\n');
    } else {
      console.log('⚠️  Profile data may not have persisted correctly\n');
    }
  } catch (error) {
    console.error('❌ Failed to verify profile:', error.response?.data || error.message);
    return;
  }

  // Step 5: Test partial update
  console.log('5️⃣ Testing partial update (only firstName)...');
  try {
    const partialUpdateResponse = await axios.patch(
      `${API_URL}/auth/profile`,
      { firstName: 'Jane' },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    console.log('✅ Partial update successful:');
    console.log(`   firstName: ${partialUpdateResponse.data.firstName} (should be "Jane")`);
    console.log(`   lastName: ${partialUpdateResponse.data.lastName} (should still be "Doe")`);
    console.log(`   age: ${partialUpdateResponse.data.age} (should still be 25)\n`);

    if (
      partialUpdateResponse.data.firstName === 'Jane' &&
      partialUpdateResponse.data.lastName === testProfile.lastName &&
      partialUpdateResponse.data.age === testProfile.age
    ) {
      console.log('✅ Partial update works correctly!\n');
    } else {
      console.log('⚠️  Partial update may not work as expected\n');
    }
  } catch (error) {
    console.error('❌ Failed to test partial update:', error.response?.data || error.message);
    return;
  }

  // Step 6: Test validation
  console.log('6️⃣ Testing validation (invalid age)...');
  try {
    await axios.patch(
      `${API_URL}/auth/profile`,
      { age: -5 },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    console.log('⚠️  Validation failed - invalid age was accepted\n');
  } catch (error) {
    if (error.response?.status === 400) {
      console.log('✅ Validation works correctly - invalid age rejected');
      console.log(`   Error: ${error.response.data.error}\n`);
    } else {
      console.error('❌ Unexpected error:', error.response?.data || error.message);
    }
  }

  console.log('🎉 All tests completed!');
}

// Run tests
testProfileAPI().catch((error) => {
  console.error('💥 Test script failed:', error.message);
  process.exit(1);
});

