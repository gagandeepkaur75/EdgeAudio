require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { login } = require('./auth');
const uploadRoute = require('./routes/upload');
const publishRoute = require('./routes/publish');
const deliverablesRoute = require('./routes/deliverables');
const meetingRoute = require('./routes/meeting');

const app = express();

// Behind Nginx / cloudflared on the same machine: trust X-Forwarded-For from
// localhost only, so req.ip is the real client (used by the login rate limit)
// but can't be spoofed by a client talking to the port directly.
app.set('trust proxy', 'loopback');

app.use(express.json({ limit: '100kb' }));

// ---------------------------------------------------------------------------
// CORS
// ALLOWED_ORIGINS is a comma-separated list. Entries may use a leading
// wildcard for subdomains, e.g.
//   ALLOWED_ORIGINS=https://edgeaudioqc.pages.dev,https://*.edgeaudioqc.pages.dev,http://localhost:5173
// If it is not set, every origin is allowed (with a startup warning) so local
// development keeps working.
// ---------------------------------------------------------------------------
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

function originAllowed(origin) {
  return allowedOrigins.some((entry) => {
    if (entry === origin) return true;
    const m = /^(https?:\/\/)\*\.(.+)$/.exec(entry);
    if (!m) return false;
    return origin.startsWith(m[1]) && origin.endsWith(`.${m[2]}`);
  });
}

if (allowedOrigins.length === 0) {
  console.warn('[cors] ALLOWED_ORIGINS is not set - allowing requests from ANY origin. Set it in production.');
}

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header (curl, server-to-server) or no allow-list configured.
      if (!origin || allowedOrigins.length === 0 || originAllowed(origin)) return callback(null, true);
      return callback(null, false); // browser blocks the response; no 500
    },
    // Auth uses a Bearer header, not cookies, so credentials aren't needed.
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ---------------------------------------------------------------------------
// Locally stored uploads (only used when S3/R2 isn't configured).
// Only types that are safe to render inline (PDF, raster images) are shown in
// the browser; everything else (HTML, SVG, scripts...) is forced to download
// so an uploaded file can never run as a page on the API's domain.
// ---------------------------------------------------------------------------
const INLINE_SAFE_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
app.use(
  '/uploads',
  express.static(path.join(__dirname, '..', 'public', 'uploads'), {
    dotfiles: 'deny',
    index: false,
    setHeaders(res, filePath) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Access-Control-Allow-Origin', '*'); // needed by the Office/PDF previewers
      if (!INLINE_SAFE_EXT.has(path.extname(filePath).toLowerCase())) {
        res.setHeader('Content-Disposition', 'attachment');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      }
    },
  })
);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/auth/login', login);
app.use('/api/upload', uploadRoute);
app.use('/api/publish', publishRoute);
app.use('/api/deliverables', deliverablesRoute);
app.use('/api/meeting', meetingRoute);

// Basic error handler so unexpected errors return JSON, not an HTML stack trace
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large (max 100 MB)' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`edgeaudioqc backend listening on port ${PORT}`);
});
