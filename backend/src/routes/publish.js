const express = require('express');
const { requireAuth } = require('../auth');
const db = require('../db');

const router = express.Router();

// POST /api/publish  (auth required)
// Body: { slug, title, deliverableType, version, presentationDate, authors,
//         changeSummary, fileKey, fileUrl, originalFilename, sizeBytes }
//
// Creates a new permanent record. Slugs are unique and never reused, so
// publishing "planning-v2" never touches or hides the "planning-v1" row -
// both stay reachable forever, satisfying the "keep every version" rule.
router.post('/', requireAuth, (req, res) => {
  const {
    slug,
    title,
    deliverableType,
    version,
    presentationDate,
    authors,
    changeSummary,
    fileKey,
    fileUrl,
    originalFilename,
    sizeBytes,
  } = req.body || {};

  const missing = ['slug', 'title', 'deliverableType', 'version', 'presentationDate', 'authors', 'fileKey', 'fileUrl']
    .filter((field) => !req.body?.[field]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const existing = db.prepare('SELECT id FROM deliverables WHERE slug = ?').get(slug);
  if (existing) {
    return res.status(409).json({ error: `Slug "${slug}" is already published. Use a new slug (e.g. planning-v2) instead of overwriting.` });
  }

  const stmt = db.prepare(`
    INSERT INTO deliverables
      (slug, title, deliverable_type, version, presentation_date, authors, change_summary, file_key, file_url, original_filename, file_size_bytes)
    VALUES (@slug, @title, @deliverableType, @version, @presentationDate, @authors, @changeSummary, @fileKey, @fileUrl, @originalFilename, @sizeBytes)
  `);

  const info = stmt.run({
    slug,
    title,
    deliverableType,
    version,
    presentationDate,
    authors,
    changeSummary: changeSummary || null,
    fileKey,
    fileUrl,
    originalFilename: originalFilename || null,
    sizeBytes: sizeBytes || null,
  });

  const record = db.prepare('SELECT * FROM deliverables WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(record);
});

module.exports = router;
