const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/deliverables            -> list everything ever published (for nav/version history)
// GET /api/deliverables?type=planning -> filter by deliverable type
// These are public, unauthenticated reads - anyone visiting the site can see the version history.
router.get('/', (req, res) => {
  const { type } = req.query;
  const rows = type
    ? db.prepare('SELECT * FROM deliverables WHERE deliverable_type = ? ORDER BY published_at ASC').all(type)
    : db.prepare('SELECT * FROM deliverables ORDER BY published_at ASC').all();
  res.json(rows);
});

// GET /api/deliverables/:slug  -> a single permanent version page's data
router.get('/:slug', (req, res) => {
  const row = db.prepare('SELECT * FROM deliverables WHERE slug = ?').get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

module.exports = router;
