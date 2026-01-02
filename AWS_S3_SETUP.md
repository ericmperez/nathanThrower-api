# AWS S3 Setup Guide

Follow these steps to configure Amazon S3 for video storage.

## Step 1: Create AWS Account (if needed)

1. Go to https://aws.amazon.com/
2. Sign up or sign in to your AWS account

## Step 2: Create S3 Bucket

1. **Go to S3 Console:**
   - Navigate to https://console.aws.amazon.com/s3/
   - Click "Create bucket"

2. **Configure Bucket:**
   - **Bucket name:** `pitchcoach-videos` (must be globally unique - add your name/numbers if taken)
   - **AWS Region:** Choose closest to you (e.g., `us-east-1`, `us-west-2`, `eu-west-1`)
   - **Object Ownership:** ACLs disabled (recommended)
   - **Block Public Access:** 
     - ✅ Uncheck "Block all public access" (if you want public video URLs)
     - OR keep it checked if videos should be private (requires signed URLs)
   - **Bucket Versioning:** Disable (unless you need it)
   - **Default encryption:** Enable (recommended)
   - **Object Lock:** Disable
   - Click "Create bucket"

## Step 3: Configure Bucket CORS (for web uploads)

1. **Go to your bucket** → Click on the bucket name
2. **Permissions tab** → Scroll to "Cross-origin resource sharing (CORS)"
3. **Edit** and paste this configuration:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET", "HEAD", "POST"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag", "x-amz-server-side-encryption"],
    "MaxAgeSeconds": 3000
  }
]
```

4. **Save changes**

## Step 4: Create IAM User for API Access

1. **Go to IAM Console:**
   - Navigate to https://console.aws.amazon.com/iam/
   - Click "Users" in left sidebar
   - Click "Create user"

2. **Set user details:**
   - **User name:** `pitchcoach-s3-user`
   - Click "Next"

3. **Set permissions:**
   - Select "Attach policies directly"
   - Search for and select: `AmazonS3FullAccess`
   - ⚠️ **For production:** Create a custom policy with only the permissions you need:
     ```json
     {
       "Version": "2012-10-17",
       "Statement": [
         {
           "Effect": "Allow",
           "Action": [
             "s3:PutObject",
             "s3:GetObject",
             "s3:DeleteObject",
             "s3:ListBucket"
           ],
           "Resource": [
             "arn:aws:s3:::pitchcoach-videos",
             "arn:aws:s3:::pitchcoach-videos/*"
           ]
         }
       ]
     }
     ```
   - Click "Next" → "Create user"

4. **Create Access Key:**
   - Click on the user you just created
   - Go to "Security credentials" tab
   - Scroll to "Access keys" section
   - Click "Create access key"
   - Select "Application running outside AWS"
   - Click "Next" → Add description (optional) → "Create access key"
   - ⚠️ **IMPORTANT:** Copy both:
     - **Access key ID**
     - **Secret access key** (you can only see this once!)

## Step 5: Configure Bucket Policy (Optional - for public access)

If you want videos to be publicly accessible:

1. Go to your bucket → **Permissions** tab
2. Scroll to "Bucket policy"
3. Click "Edit" and add:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::pitchcoach-videos/*"
    }
  ]
}
```

Replace `pitchcoach-videos` with your actual bucket name.

## Step 6: Add to .env File

Add these variables to your `apps/api/.env` file:

```bash
# AWS S3 Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id-here
AWS_SECRET_ACCESS_KEY=your-secret-access-key-here
S3_BUCKET=pitchcoach-videos
# Leave S3_ENDPOINT empty for AWS S3 (or don't include it)
```

**Important:** 
- Replace `us-east-1` with your chosen region
- Replace `pitchcoach-videos` with your actual bucket name
- Replace the access keys with your actual credentials
- **Do NOT set S3_ENDPOINT** (leave it empty or omit it) - this is only for S3-compatible services

## Step 7: Test Your Configuration

1. **Start your API server:**
   ```bash
   cd apps/api
   npm run dev
   ```

2. **Test the presign endpoint:**
   ```bash
   # First, login to get a token
   curl -X POST http://localhost:4000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"demo@example.com","password":"demo123"}'
   
   # Copy the accessToken from response, then:
   curl -X POST http://localhost:4000/api/videos/presign \
     -H "Authorization: Bearer YOUR_TOKEN_HERE" \
     -H "Content-Type: application/json" \
     -d '{"filename":"test.mp4","contentType":"video/mp4"}'
   ```

You should get a response with `uploadUrl` and `publicUrl`.

## Cost Estimates

AWS S3 pricing (approximate):
- **Storage:** ~$0.023 per GB/month
- **PUT requests:** ~$0.005 per 1,000 requests
- **GET requests:** ~$0.0004 per 1,000 requests
- **Data transfer out:** First 100 GB/month free, then ~$0.09 per GB

For a small app with 100GB storage and moderate usage: ~$2-5/month

## Security Best Practices

1. ✅ **Never commit `.env` file** (already in `.gitignore`)
2. ✅ Use IAM policies with least privilege (don't use full S3 access in production)
3. ✅ Rotate access keys periodically
4. ✅ Enable S3 bucket versioning for important data
5. ✅ Set up lifecycle policies to delete old videos after X days
6. ✅ Enable CloudTrail to monitor S3 access
7. ✅ Use bucket encryption (already enabled in step 2)

## Troubleshooting

### "Access Denied" errors
- Verify access keys are correct
- Check bucket name matches `S3_BUCKET` in `.env`
- Ensure IAM user has correct permissions
- Check bucket region matches `AWS_REGION`

### "InvalidAccessKeyId" errors
- Verify `AWS_ACCESS_KEY_ID` is correct
- Check for extra spaces or newlines in `.env` file

### "SignatureDoesNotMatch" errors
- Verify `AWS_SECRET_ACCESS_KEY` is correct
- Ensure no extra spaces in `.env` file

### Videos not accessible
- Check bucket public access settings
- Verify bucket policy if using public access
- Check CORS configuration

## Next Steps

Once configured, your app will:
1. ✅ Generate presigned URLs for secure uploads
2. ✅ Upload videos directly to S3
3. ✅ Store video URLs in your database
4. ✅ Serve videos from S3

You're all set! 🎉


