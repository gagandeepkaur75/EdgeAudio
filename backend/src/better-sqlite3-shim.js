const fs = require('fs');
const path = require('path');

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.trim().replace(/\s+/g, ' ');
  }

  // Parse parameters
  _bind(params) {
    if (params.length === 1 && typeof params[0] === 'object' && params[0] !== null) {
      return params[0];
    }
    return params;
  }

  get(...params) {
    const bound = this._bind(params);
    const data = this.db._load();
    
    // Simple mock matches for our queries
    // 1. SELECT id FROM deliverables WHERE slug = ?
    if (this.sql.includes('SELECT id FROM deliverables WHERE slug = ?')) {
      const slug = Array.isArray(bound) ? bound[0] : bound;
      const row = data.find(d => d.slug === slug);
      return row ? { id: row.id } : undefined;
    }
    // 2. SELECT * FROM deliverables WHERE slug = ?
    if (this.sql.includes('SELECT * FROM deliverables WHERE slug = ?')) {
      const slug = Array.isArray(bound) ? bound[0] : bound;
      const row = data.find(d => d.slug === slug);
      return row || undefined;
    }
    // 3. SELECT * FROM deliverables WHERE id = ?
    if (this.sql.includes('SELECT * FROM deliverables WHERE id = ?')) {
      const id = Number(Array.isArray(bound) ? bound[0] : bound);
      const row = data.find(d => d.id === id);
      return row || undefined;
    }
    return undefined;
  }

  all(...params) {
    const bound = this._bind(params);
    const data = this.db._load();
    
    // SELECT * FROM deliverables WHERE deliverable_type = ? ORDER BY published_at ASC
    if (this.sql.includes('deliverable_type = ?')) {
      const type = Array.isArray(bound) ? bound[0] : bound;
      return data.filter(d => d.deliverable_type === type).sort((a,b) => a.published_at.localeCompare(b.published_at));
    }
    // SELECT * FROM deliverables ORDER BY published_at ASC
    return [...data].sort((a,b) => a.published_at.localeCompare(b.published_at));
  }

  run(...params) {
    const bound = this._bind(params);
    const data = this.db._load();
    
    // INSERT INTO deliverables ...
    if (this.sql.includes('INSERT INTO deliverables')) {
      const newId = data.length > 0 ? Math.max(...data.map(d => d.id)) + 1 : 1;
      
      const newRecord = {
        id: newId,
        slug: bound.slug,
        title: bound.title,
        deliverable_type: bound.deliverableType,
        version: bound.version,
        presentation_date: bound.presentationDate,
        authors: bound.authors,
        change_summary: bound.changeSummary || null,
        file_key: bound.fileKey,
        file_url: bound.fileUrl,
        original_filename: bound.originalFilename || null,
        file_size_bytes: bound.sizeBytes || null,
        published_at: new Date().toISOString()
      };
      
      data.push(newRecord);
      this.db._save(data);
      return { lastInsertRowid: newId, changes: 1 };
    }
    
    return { lastInsertRowid: 0, changes: 0 };
  }
}

class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(dbPath)) {
      const content = fs.readFileSync(dbPath, 'utf8');
      const trimmed = content.trim();
      // Never delete an existing file we don't understand (e.g. a real SQLite
      // database from the older backend) - that would silently wipe every
      // published deliverable. Refuse to start instead.
      if (trimmed !== '' && !trimmed.startsWith('[')) {
        throw new Error(
          `DB file "${dbPath}" is not in the JSON format this backend uses ` +
          `(it may be a SQLite database). Move it aside or point DB_PATH at a different file.`
        );
      }
      if (trimmed === '') {
        fs.writeFileSync(dbPath, '[]');
      }
    }
    if (!fs.existsSync(dbPath)) {
      fs.writeFileSync(dbPath, '[]');
    }
  }

  pragma(_arg) {
    return this;
  }

  exec(_arg) {
    return this;
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  _load() {
    if (!fs.existsSync(this.dbPath)) return [];
    // Let parse errors propagate: returning [] here would make the next
    // insert overwrite the whole file with a single record.
    return JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
  }

  _save(data) {
    // Write to a temp file and rename over the original, so a crash mid-write
    // can never leave a truncated/corrupt database behind. Errors propagate so
    // the API reports a failure instead of claiming the publish succeeded.
    const tmpPath = `${this.dbPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, this.dbPath);
  }
}

module.exports = Database;
