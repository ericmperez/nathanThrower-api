# Fix Video Playback Issue

The video isn't playing because your S3 bucket needs CORS (Cross-Origin Resource Sharing) configured to allow video playback in web browsers.

## Quick Fix: Configure S3 CORS

1. **Go to AWS S3 Console:**
   - Navigate to https://console.aws.amazon.com/s3/
   - Click on your bucket: `pitchcoach-videos`

2. **Open Permissions Tab:**
   - Click the "Permissions" tab
   - Scroll down to "Cross-origin resource sharing (CORS)"

3. **Edit CORS Configuration:**
   - Click "Edit"
   - Paste this configuration:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD", "PUT", "POST"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3000
  }
]
```

4. **Save Changes:**
   - Click "Save changes"

## For Production (More Secure)

If you want to restrict CORS to specific domains, replace `"*"` in `AllowedOrigins` with your actual domains:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD", "PUT", "POST"],
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://your-admin-domain.com",
      "https://your-mobile-app-domain.com"
    ],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3000
  }
]
```

## Verify It Works

After configuring CORS:

1. **Clear your browser cache** (or do a hard refresh: Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)
2. **Reload the admin dashboard**
3. **Try playing the video again**

The video should now play! If it still doesn't work, check the browser console (F12) for any error messages.

## Additional Notes

- CORS changes can take a few seconds to propagate
- Make sure your bucket's public access settings allow the videos to be read
- The video URL format should be: `https://pitchcoach-videos.s3.us-east-2.amazonaws.com/videos/...`


