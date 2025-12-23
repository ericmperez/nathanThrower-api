import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PresignRequestSchema } from '../lib/shared';
import { generatePresignedUploadUrl } from '../lib/s3';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// File upload validation constants
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_CONTENT_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo', // .avi
  'video/webm',
  'video/mov',
  'video/avi',
];

// Validate file type
function isValidContentType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPES.includes(contentType);
}

// Validate file size (if provided)
function isValidFileSize(sizeBytes?: number): boolean {
  if (sizeBytes === undefined) {
    return true; // Size validation is optional on presign
  }
  return sizeBytes > 0 && sizeBytes <= MAX_FILE_SIZE;
}

// Generate presigned URL for video upload
router.post('/presign', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const data = PresignRequestSchema.parse(req.body);

    // Validate content type
    if (!isValidContentType(data.contentType)) {
      return res.status(400).json({
        error: 'Invalid file type',
        message: `Allowed types: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
        allowedTypes: ALLOWED_CONTENT_TYPES,
      });
    }

    // Validate file size if provided (optional field in request body)
    const sizeBytes = typeof req.body === 'object' && req.body !== null && 'sizeBytes' in req.body
      ? (req.body as { sizeBytes?: number }).sizeBytes
      : undefined;
    
    if (sizeBytes !== undefined && !isValidFileSize(sizeBytes)) {
      return res.status(400).json({
        error: 'File size exceeds limit',
        message: `Maximum file size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
        maxSizeBytes: MAX_FILE_SIZE,
      });
    }

    // Generate unique key
    const ext = data.filename.split('.').pop();
    const key = `videos/${req.user!.userId}/${uuidv4()}.${ext}`;

    // Generate presigned URL
    const { uploadUrl, publicUrl } = await generatePresignedUploadUrl(
      key,
      data.contentType
    );

    res.json({
      uploadUrl,
      videoKey: key,
      publicUrl,
      maxSizeBytes: MAX_FILE_SIZE,
      allowedContentTypes: ALLOWED_CONTENT_TYPES,
    });
  } catch (error: any) {
    console.error('Presign error:', error);
    // Pass error to error handler with more context
    const err = new Error(error.message || 'Failed to generate presigned URL');
    (err as any).statusCode = error.statusCode || 500;
    (err as any).code = error.code;
    next(err);
  }
});

export default router;
