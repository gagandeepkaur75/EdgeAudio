const express = require('express');
const { requireAuth } = require('../auth');
const db = require('../db');

const router = express.Router();

const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;
// Paths the frontend router already uses for its own pages (see src/App.jsx).
// "planning-v1" is NOT reserved: that page shows the published deliverable
// when one exists.
const RESERVED_SLUGS = new Set([
  'project', 'team', 'timeline', 'architecture', 'live-communication', 'live',
  'live-test', 'planning', 'admin', 'deliverables', 'final-presentation', 'api', 'uploads', 'assets',
  'models', 'audio',
]);

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

  const nonString = ['slug', 'title', 'deliverableType', 'version', 'presentationDate', 'authors', 'fileKey', 'fileUrl', 'changeSummary', 'originalFilename']
    .filter((field) => req.body[field] != null && typeof req.body[field] !== 'string');
  if (nonString.length) {
    return res.status(400).json({ error: `These fields must be text: ${nonString.join(', ')}` });
  }

  // The slug becomes the page URL (https://site/<slug>), so it must be URL-safe
  // and must not collide with one of the site's own pages, which would hide it.
  if (!SLUG_PATTERN.test(slug)) {
    return res.status(400).json({ error: 'Slug must be 1-80 characters: lowercase letters, numbers, "-" or "_", starting with a letter or number.' });
  }
  if (RESERVED_SLUGS.has(slug)) {
    return res.status(400).json({ error: `"${slug}" is already used by a page on the site. Choose a different slug.` });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(presentationDate)) {
    return res.status(400).json({ error: 'presentationDate must be in YYYY-MM-DD format' });
  }
  if (!/^https?:\/\//i.test(fileUrl)) {
    return res.status(400).json({ error: 'fileUrl must be an http(s) URL' });
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
