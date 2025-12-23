// Quick S3 connection test script
require('dotenv').config();
const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const BUCKET = process.env.S3_BUCKET || 'pitchcoach-videos';

async function testS3Connection() {
  console.log('🧪 Testing S3 connection...\n');
  console.log(`Region: ${process.env.AWS_REGION}`);
  console.log(`Bucket: ${BUCKET}`);
  console.log(`Access Key ID: ${process.env.AWS_ACCESS_KEY_ID ? '✅ Set' : '❌ Missing'}`);
  console.log(`Secret Key: ${process.env.AWS_SECRET_ACCESS_KEY ? '✅ Set' : '❌ Missing'}\n`);

  try {
    // Test 1: List bucket (checks permissions)
    console.log('Test 1: Checking bucket access...');
    await s3.headBucket({ Bucket: BUCKET }).promise();
    console.log('✅ Bucket exists and is accessible!\n');

    // Test 2: Generate presigned URL
    console.log('Test 2: Generating presigned URL...');
    const testKey = `test/connection-test-${Date.now()}.txt`;
    const uploadUrl = await s3.getSignedUrlPromise('putObject', {
      Bucket: BUCKET,
      Key: testKey,
      ContentType: 'text/plain',
      Expires: 600,
    });
    console.log('✅ Presigned URL generated successfully!');
    console.log(`   Upload URL: ${uploadUrl.substring(0, 80)}...\n`);

    // Test 3: Check public URL format
    const region = process.env.AWS_REGION || 'us-east-1';
    const publicUrl = `https://${BUCKET}.s3.${region}.amazonaws.com/${testKey}`;
    console.log('Test 3: Public URL format:');
    console.log(`   ${publicUrl}\n`);

    console.log('🎉 All tests passed! S3 is configured correctly.\n');
    console.log('Next steps:');
    console.log('1. Make sure your bucket has CORS configured (see AWS_S3_SETUP.md)');
    console.log('2. Start your API server: npm run dev');
    console.log('3. Test video upload from your mobile app');

  } catch (error) {
    console.error('❌ S3 connection test failed!\n');
    console.error('Error:', error.message);
    console.error('\nTroubleshooting:');
    
    if (error.code === 'NoSuchBucket') {
      console.error('- Bucket does not exist. Create it in AWS Console.');
    } else if (error.code === 'AccessDenied') {
      console.error('- Access denied. Check your IAM user permissions.');
    } else if (error.code === 'InvalidAccessKeyId') {
      console.error('- Invalid access key. Check AWS_ACCESS_KEY_ID in .env');
    } else if (error.code === 'SignatureDoesNotMatch') {
      console.error('- Invalid secret key. Check AWS_SECRET_ACCESS_KEY in .env');
    } else {
      console.error('- Check your AWS credentials and bucket name in .env');
    }
    process.exit(1);
  }
}

testS3Connection();
