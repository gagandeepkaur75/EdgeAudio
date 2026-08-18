const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../auth');
const { uploadFile } = require('../storage');

const router = express.Router();

// Files are held in memory only briefly, then streamed to S3/R2 - nothing
// is written to the server's local disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB cap, adjust as needed
});

// POST /api/upload  (auth required, multipart/form-data, field name "file")
// Uploads the raw file to object storage and returns its key + URL.
// This does NOT publish anything yet - see /api/publish for that step.
router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided (expected form field "file")' });
  }

  try {
    const { key, fileUrl } = await uploadFile({
      buffer: req.file.buffer,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    res.json({
      fileKey: key,
      fileUrl,
      originalFilename: req.file.originalname,
      sizeBytes: req.file.size,
    });
  } catch (err) {
    console.error('Upload failed:', err);
    res.status(500).json({ error: 'Upload to storage failed' });
  }
});

module.exports = router;
