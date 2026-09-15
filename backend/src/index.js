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
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

// Universal CORS configuration to support Cloudflare Workers, Pages, Localhost, and Tunnels
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
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
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`edgeaudioqc backend listening on port ${PORT}`);
});
