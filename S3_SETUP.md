# S3 Storage Setup Guide

This guide will help you configure S3-compatible storage for video uploads. You have three main options:

## Option 1: Cloudflare R2 (Recommended for Development) ⭐

**Free tier:** 10GB storage, 1M Class A operations/month

### Steps:

1. **Create a Cloudflare account** (if you don't have one)
   - Go to https://dash.cloudflare.com/sign-up

2. **Create an R2 bucket:**
   - Go to Cloudflare Dashboard → R2 → Create bucket
   - Name it: `pitchcoach-videos` (or any name you prefer)
   - Choose a location close to you

3. **Create API Token:**
   - Go to R2 → Manage R2 API Tokens → Create API Token
   - Permissions: Object Read & Write
   - TTL: No expiration (or set a long expiration)
   - Copy the **Access Key ID** and **Secret Access Key**

4. **Get your R2 endpoint:**
   - Go to your bucket → Settings
   - Find "S3 API" section
   - Copy the endpoint URL (e.g., `https://[account-id].r2.cloudflarestorage.com`)

5. **Make bucket public (for video playback):**
   - Go to R2 → Your bucket → Settings → Public Access
   - Enable "Allow Access" and set a custom domain (optional) or use the R2.dev subdomain

6. **Add to `.env` file:**
   ```bash
   AWS_REGION=auto
   AWS_ACCESS_KEY_ID=your-r2-access-key-id
   AWS_SECRET_ACCESS_KEY=your-r2-secret-access-key
   S3_BUCKET=pitchcoach-videos
   S3_ENDPOINT=https://[account-id].r2.cloudflarestorage.com
   ```

---

## Option 2: AWS S3 (Production)

**Cost:** ~$0.023 per GB/month + transfer costs

### Steps:

1. **Create AWS account** (if you don't have one)
   - Go to https://aws.amazon.com/

2. **Create S3 bucket:**
   - Go to AWS Console → S3 → Create bucket
   - Name: `pitchcoach-videos` (must be globally unique)
   - Region: Choose closest to you (e.g., `us-east-1`)
   - Uncheck "Block all public access" if you want public video URLs
   - Create bucket

3. **Create IAM user for API access:**
   - Go to IAM → Users → Create user
   - Name: `pitchcoach-s3-user`
   - Attach policy: `AmazonS3FullAccess` (or create custom policy with only needed permissions)
   - Create user → Security credentials → Create access key
   - Copy **Access Key ID** and **Secret Access Key**

4. **Configure bucket CORS (for web uploads):**
   - Go to bucket → Permissions → CORS
   - Add CORS configuration:
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedOrigins": ["*"],
       "ExposeHeaders": ["ETag"]
     }
   ]
   ```

5. **Add to `.env` file:**
   ```bash
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your-aws-access-key-id
   AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key
   S3_BUCKET=pitchcoach-videos
   # Leave S3_ENDPOINT empty for AWS S3
   S3_ENDPOINT=
   ```

---

## Option 3: MinIO (Local Development)

**Free:** Self-hosted S3-compatible storage

### Steps:

1. **Install MinIO:**
   ```bash
   # Using Docker (easiest)
   docker run -d \
     -p 9000:9000 \
     -p 9001:9001 \
     --name minio \
     -e "MINIO_ROOT_USER=minioadmin" \
     -e "MINIO_ROOT_PASSWORD=minioadmin" \
     minio/minio server /data --console-address ":9001"
   ```

2. **Create bucket:**
   - Open http://localhost:9001 in browser
   - Login: `minioadmin` / `minioadmin`
   - Create bucket: `pitchcoach-videos`
   - Set bucket policy to "public" for testing

3. **Create access key:**
   - Go to Access Keys → Create access key
   - Copy Access Key and Secret Key

4. **Add to `.env` file:**
   ```bash
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your-minio-access-key
   AWS_SECRET_ACCESS_KEY=your-minio-secret-key
   S3_BUCKET=pitchcoach-videos
   S3_ENDPOINT=http://localhost:9000
   ```

---

## Quick Start (Cloudflare R2)

If you want to get started quickly with Cloudflare R2:

1. Sign up at https://dash.cloudflare.com
2. Go to R2 → Create bucket → Name it `pitchcoach-videos`
3. Create API token (R2 → Manage R2 API Tokens)
4. Copy your endpoint from bucket settings
5. Update your `.env` file with the R2 credentials

**Example `.env` for R2:**
```bash
AWS_REGION=auto
AWS_ACCESS_KEY_ID=abc123...
AWS_SECRET_ACCESS_KEY=xyz789...
S3_BUCKET=pitchcoach-videos
S3_ENDPOINT=https://abc123def456.r2.cloudflarestorage.com
```

---

## Testing Your Setup

After configuring, test the upload:

1. Start your API server:
   ```bash
   cd apps/api
   npm run dev
   ```

2. Test the presign endpoint (requires authentication):
   ```bash
   # First login to get a token
   curl -X POST http://localhost:4000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"demo@example.com","password":"demo123"}'
   
   # Then test presign (replace TOKEN with your JWT)
   curl -X POST http://localhost:4000/api/videos/presign \
     -H "Authorization: Bearer TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"filename":"test.mp4","contentType":"video/mp4"}'
   ```

You should get back a presigned URL that you can use to upload videos.

---

## Troubleshooting

### "Access Denied" errors
- Check your access keys are correct
- Verify bucket name matches `S3_BUCKET` in `.env`
- For R2/MinIO: Ensure `S3_ENDPOINT` is set correctly

### "Invalid endpoint" errors
- For AWS S3: Leave `S3_ENDPOINT` empty or remove it
- For R2/MinIO: Ensure endpoint URL is correct and includes `https://` or `http://`

### Videos not accessible publicly
- For AWS S3: Configure bucket policy for public read access
- For R2: Enable public access in bucket settings
- For MinIO: Set bucket policy to "public" in console

---

## Security Notes

- **Never commit `.env` file to git** (it's already in `.gitignore`)
- Use IAM policies with least privilege (don't use full S3 access in production)
- Consider using environment-specific buckets (dev/staging/prod)
- Set up lifecycle policies to delete old videos after a certain period


