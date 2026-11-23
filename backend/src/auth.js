const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ---------------------------------------------------------------------------
// Brute-force protection: after MAX_FAILURES failed logins from one IP within
// WINDOW_MS, further attempts from that IP are rejected until the window ends.
// In-memory is enough for a single-instance server.
// ---------------------------------------------------------------------------
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map(); // ip -> { count, firstAt }

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failures) {
    if (now - entry.firstAt > WINDOW_MS) failures.delete(ip);
  }
}, 60 * 1000).unref();

function isLockedOut(ip) {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(ip) {
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.firstAt > WINDOW_MS) {
    failures.set(ip, { count: 1, firstAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    if (!process.env.JWT_SECRET || !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) {
      console.error('Login is not configured: set JWT_SECRET, ADMIN_USERNAME and ADMIN_PASSWORD_HASH in .env');
      return res.status(500).json({ error: 'Login is not configured on the server' });
    }

    const ip = req.ip || 'unknown';
    if (isLockedOut(ip)) {
      res.set('Retry-After', String(Math.ceil(WINDOW_MS / 1000)));
      return res.status(429).json({ error: 'Too many failed login attempts. Try again in 15 minutes.' });
    }

    // Always run bcrypt (even for a wrong username) so response time doesn't
    // reveal whether the username exists. Async compare doesn't block the server.
    const validUsername = username === process.env.ADMIN_USERNAME;
    const passwordMatches = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);

    if (!validUsername || !passwordMatches) {
      recordFailure(ip);
      // Same error for both cases, so we don't reveal which part was wrong.
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    failures.delete(ip);
    const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
    const token = jwt.sign({ sub: username, role: 'admin' }, process.env.JWT_SECRET, { expiresIn });
    res.json({ token, expiresIn });
  } catch (err) {
    next(err);
  }
}

/** Express middleware: requires a valid "Authorization: Bearer <token>" header. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { login, requireAuth };
