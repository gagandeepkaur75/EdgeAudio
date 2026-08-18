const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const validUsername = username === process.env.ADMIN_USERNAME;
  const validPassword =
    validUsername &&
    process.env.ADMIN_PASSWORD_HASH &&
    bcrypt.compareSync(password, process.env.ADMIN_PASSWORD_HASH);

  if (!validUsername || !validPassword) {
    // Same error for both cases, so we don't reveal which part was wrong.
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = jwt.sign(
    { sub: username, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  res.json({ token, expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
}

/** Express middleware: requires a valid "Authorization: Bearer <token>" header. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { login, requireAuth };
