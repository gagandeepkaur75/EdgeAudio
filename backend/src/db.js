const Database = require('./better-sqlite3-shim');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || './data/app.db';
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Every published deliverable gets its own permanent row, identified by a
// unique slug (e.g. "planning-v1", "planning-v2", "midsem-demo"). Rows are
// never overwritten or deleted, so old versions stay reachable forever.
db.exec(`
  CREATE TABLE IF NOT EXISTS deliverables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    deliverable_type TEXT NOT NULL,     -- e.g. "planning", "midsem", "final-demo"
    version TEXT NOT NULL,              -- e.g. "v1", "v2"
    presentation_date TEXT NOT NULL,
    authors TEXT NOT NULL,              -- comma-separated names
    change_summary TEXT,
    file_key TEXT NOT NULL,             -- object storage key
    file_url TEXT NOT NULL,             -- public URL to the stored file
    original_filename TEXT,
    file_size_bytes INTEGER,
    published_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
