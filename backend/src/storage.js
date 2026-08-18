const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Determine if we should use local disk storage fallback or real S3.
// We use S3 if S3_ACCESS_KEY_ID and S3_BUCKET are defined.
const useS3 = !!(process.env.S3_ACCESS_KEY_ID && process.env.S3_BUCKET);

let s3 = null;
if (useS3) {
  s3 = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined, // undefined -> real AWS S3 default endpoint
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
}

const BUCKET = process.env.S3_BUCKET;
const PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL; // e.g. https://pub-xxxx.r2.dev or https://your-bucket.s3.amazonaws.com

/**
 * Uploads a file buffer to object storage under a collision-resistant key,
 * and returns the key plus a public URL to read it back.
 * If S3 is not configured, falls back to saving it to local server disk storage.
 */
async function uploadFile({ buffer, originalFilename, mimeType }) {
  const ext = path.extname(originalFilename || '');
  const safeBase = path
    .basename(originalFilename || 'file', ext)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60);
  const key = `uploads/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeBase}${ext}`;

  if (useS3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType || 'application/octet-stream',
      })
    );

    const fileUrl = `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
    return { key, fileUrl };
  } else {
    // Local storage fallback
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    // Save the file
    const localPath = path.join(uploadDir, path.basename(key));
    fs.writeFileSync(localPath, buffer);
    
    const localBaseUrl = process.env.LOCAL_UPLOAD_URL || 'http://localhost:3000';
    const fileUrl = `${localBaseUrl.replace(/\/$/, '')}/uploads/${path.basename(key)}`;
    
    return { key, fileUrl };
  }
}

module.exports = { uploadFile };
