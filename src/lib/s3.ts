import AWS from 'aws-sdk';

const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  endpoint: process.env.S3_ENDPOINT,
  s3ForcePathStyle: !!process.env.S3_ENDPOINT, // Required for R2/MinIO
});

const BUCKET = process.env.S3_BUCKET || 'pitchcoach-videos';

export async function generatePresignedUploadUrl(
  key: string,
  contentType: string
): Promise<{ uploadUrl: string; publicUrl: string }> {
  // Validate S3 configuration
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS credentials are not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your .env file.');
  }

  if (!BUCKET) {
    throw new Error('S3_BUCKET is not configured. Please set S3_BUCKET in your .env file.');
  }

  try {
    const uploadUrl = await s3.getSignedUrlPromise('putObject', {
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      Expires: 600, // 10 minutes
    });

    // Generate public URL based on endpoint configuration
    let publicUrl: string;
    if (process.env.S3_ENDPOINT) {
      // For S3-compatible services (R2, MinIO, etc.)
      const endpoint = process.env.S3_ENDPOINT.replace(/\/$/, ''); // Remove trailing slash
      publicUrl = `${endpoint}/${BUCKET}/${key}`;
    } else {
      // For AWS S3
      const region = process.env.AWS_REGION || 'us-east-1';
      publicUrl = `https://${BUCKET}.s3.${region}.amazonaws.com/${key}`;
    }

    return { uploadUrl, publicUrl };
  } catch (error: any) {
    console.error('S3 presigned URL generation error:', error);
    throw new Error(`Failed to generate presigned URL: ${error.message || error.code || 'Unknown error'}`);
  }
}

export async function getObject(key: string): Promise<AWS.S3.GetObjectOutput> {
  return s3.getObject({ Bucket: BUCKET, Key: key }).promise();
}

export async function deleteObject(key: string): Promise<void> {
  await s3.deleteObject({ Bucket: BUCKET, Key: key }).promise();
}

/**
 * Generate a presigned URL for viewing/downloading a video
 * This bypasses CORS issues because signed URLs work differently
 */
export async function generatePresignedViewUrl(
  key: string,
  expiresIn: number = 3600 // 1 hour default
): Promise<string> {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS credentials are not configured.');
  }

  if (!key) {
    throw new Error('Video key is required.');
  }

  try {
    const url = await s3.getSignedUrlPromise('getObject', {
      Bucket: BUCKET,
      Key: key,
      Expires: expiresIn,
    });

    return url;
  } catch (error: any) {
    console.error('S3 presigned view URL generation error:', error);
    throw new Error(`Failed to generate presigned view URL: ${error.message || error.code || 'Unknown error'}`);
  }
}

export { s3, BUCKET };
