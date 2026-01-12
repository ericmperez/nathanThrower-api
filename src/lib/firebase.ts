import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
// Uses FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY from .env

let firebaseApp: admin.app.App | null = null;

function getFirebaseApp(): admin.app.App {
  if (firebaseApp) {
    return firebaseApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase credentials not configured. Please set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in your .env file.'
    );
  }

  // Storage bucket defaults to {projectId}.appspot.com if not specified
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      // Private key comes with escaped newlines from .env, need to unescape them
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
    storageBucket,
  });

  return firebaseApp;
}

export function getFirebaseStorage(): admin.storage.Storage {
  return getFirebaseApp().storage();
}

export function getFirebaseBucket() {
  return getFirebaseStorage().bucket();
}

/**
 * Generate a signed URL for uploading a file to Firebase Storage
 */
export async function generateFirebaseUploadUrl(
  filePath: string,
  contentType: string,
  expiresInMinutes: number = 15
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const bucket = getFirebaseBucket();
  const file = bucket.file(filePath);

  // Generate signed URL for uploading
  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
    contentType,
  });

  // Make the file publicly readable after upload
  // The public URL format for Firebase Storage
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  const encodedPath = encodeURIComponent(filePath);
  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media`;

  return { uploadUrl, publicUrl };
}

/**
 * Make a file publicly accessible
 */
export async function makeFilePublic(filePath: string): Promise<void> {
  const bucket = getFirebaseBucket();
  const file = bucket.file(filePath);
  await file.makePublic();
}

/**
 * Delete a file from Firebase Storage
 */
export async function deleteFirebaseFile(filePath: string): Promise<void> {
  const bucket = getFirebaseBucket();
  const file = bucket.file(filePath);
  await file.delete();
}
