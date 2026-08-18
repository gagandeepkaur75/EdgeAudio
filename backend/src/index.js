require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { login } = require('./auth');
const uploadRoute = require('./routes/upload');
const publishRoute = require('./routes/publish');
const deliverablesRoute = require('./routes/deliverables');

const app = express();
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

// Only allow requests from the Cloudflare Pages frontend (and any other
// origins you list in .env). Without this, the browser blocks the
// deployed frontend from calling this API at all.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow tools like curl/Postman (no origin header) and any listed origin.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} not allowed by CORS`));
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

// Basic error handler so unexpected errors return JSON, not an HTML stack trace
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`edgeaudioqc backend listening on port ${PORT}`);
});
