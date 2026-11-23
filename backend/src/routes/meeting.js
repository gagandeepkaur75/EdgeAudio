const express = require('express');
const router = express.Router();

// In-memory room state:
// { [meetingId]: { createdAt, users: { [userId]: { userId, role, joinedAt, lastSeen } }, signals: { [userId]: [signals] } } }
const rooms = {};

// Limits that keep a misbehaving or malicious client from exhausting memory.
const USER_TIMEOUT_MS = 45000;
const MAX_ROOMS = 500;
const MAX_USERS_PER_ROOM = 8;
const MAX_QUEUED_SIGNALS = 200; // per user; oldest are dropped first
const MAX_SIGNAL_BYTES = 16 * 1024; // an SDP offer is a few KB
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Clean up inactive users, and rooms that become empty
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of Object.entries(rooms)) {
    for (const [userId, user] of Object.entries(room.users)) {
      if (now - user.lastSeen > USER_TIMEOUT_MS) {
        delete room.users[userId];
        delete room.signals[userId];
      }
    }
    if (Object.keys(room.users).length === 0) {
      delete rooms[roomId];
    }
  }
}, 10000).unref();

/** Returns a normalized room id, or null if the input isn't a valid id. */
function cleanRoomId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().toUpperCase();
  return ID_PATTERN.test(id) ? id : null;
}

function validUserId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function publicParticipants(room) {
  return Object.values(room.users).map(({ userId, role, joinedAt }) => ({ userId, role, joinedAt }));
}

/**
 * Check if a meeting room exists and is active
 */
router.get('/:meetingId/check', (req, res) => {
  const roomId = cleanRoomId(req.params.meetingId);
  if (!roomId) return res.status(400).json({ exists: false, error: 'Invalid meeting ID' });

  const room = rooms[roomId];
  if (!room || Object.keys(room.users).length === 0) {
    return res.status(404).json({
      exists: false,
      error: `Meeting room "${roomId}" does not exist or has ended.`,
    });
  }

  const participants = publicParticipants(room);
  res.json({ exists: true, meetingId: roomId, participantCount: participants.length, participants });
});

/**
 * Create or Join a meeting room with strict validation
 */
router.post('/join', (req, res) => {
  const { meetingId, userId, role } = req.body || {};
  const roomId = cleanRoomId(meetingId);
  if (!roomId || !validUserId(userId)) {
    return res.status(400).json({ error: 'Valid meetingId and userId are required' });
  }

  const isHost = role === 'host';
  const existingRoom = rooms[roomId];

  // If joining as peer (not host), room MUST exist and have active users
  if (!isHost && (!existingRoom || Object.keys(existingRoom.users).length === 0)) {
    return res.status(404).json({
      error: `Meeting room "${roomId}" does not exist. Please check the room code or start a new call.`,
    });
  }

  if (!existingRoom && Object.keys(rooms).length >= MAX_ROOMS) {
    return res.status(503).json({ error: 'Too many active rooms. Please try again later.' });
  }

  const room = existingRoom || (rooms[roomId] = { createdAt: Date.now(), users: {}, signals: {} });
  if (!room.users[userId] && Object.keys(room.users).length >= MAX_USERS_PER_ROOM) {
    return res.status(409).json({ error: 'This meeting room is full.' });
  }

  room.users[userId] = {
    userId,
    role: isHost ? 'host' : 'peer',
    joinedAt: room.users[userId]?.joinedAt || Date.now(),
    lastSeen: Date.now(),
  };
  if (!room.signals[userId]) room.signals[userId] = [];

  const participants = publicParticipants(room);
  res.json({ success: true, meetingId: roomId, participantCount: participants.length, participants });
});

/**
 * Poll for room state, active participants, and incoming WebRTC signals.
 * Only users who joined via /join get a heartbeat; polling no longer silently
 * re-adds a user who left or timed out.
 */
router.get('/:meetingId/poll', (req, res) => {
  const roomId = cleanRoomId(req.params.meetingId);
  const { userId } = req.query;
  if (!roomId || !validUserId(userId)) {
    return res.status(400).json({ error: 'Valid meetingId and userId are required' });
  }

  const room = rooms[roomId];
  if (!room) {
    return res.json({ participantCount: 0, participants: [], signals: [], joined: false });
  }

  const user = room.users[userId];
  if (user) user.lastSeen = Date.now();

  // Hand out each signal exactly once
  const incomingSignals = user ? room.signals[userId] || [] : [];
  if (user) room.signals[userId] = [];

  const participants = publicParticipants(room);
  res.json({
    participantCount: participants.length,
    participants,
    signals: incomingSignals,
    joined: !!user,
  });
});

/**
 * Send WebRTC signal (Offer, Answer, or ICE candidate) to peer
 */
router.post('/signal', (req, res) => {
  const { meetingId, senderId, targetId, signalData } = req.body || {};
  const roomId = cleanRoomId(meetingId);
  if (!roomId || !validUserId(senderId) || !signalData || typeof signalData !== 'object') {
    return res.status(400).json({ error: 'meetingId, senderId, and signalData are required' });
  }
  if (JSON.stringify(signalData).length > MAX_SIGNAL_BYTES) {
    return res.status(413).json({ error: 'Signal too large' });
  }

  const room = rooms[roomId];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (!room.users[senderId]) return res.status(403).json({ error: 'Sender is not in this room' });

  // Deliver only to current members: to the target if given, else to everyone but the sender
  const targets = targetId
    ? (room.users[targetId] ? [targetId] : [])
    : Object.keys(room.users).filter((id) => id !== senderId);

  for (const tid of targets) {
    const queue = room.signals[tid] || (room.signals[tid] = []);
    queue.push({ senderId, signalData, timestamp: Date.now() });
    if (queue.length > MAX_QUEUED_SIGNALS) queue.splice(0, queue.length - MAX_QUEUED_SIGNALS);
  }

  res.json({ success: true, delivered: targets.length });
});

/**
 * Leave meeting room
 */
router.post('/leave', (req, res) => {
  const { meetingId, userId } = req.body || {};
  const roomId = cleanRoomId(meetingId);
  if (roomId && validUserId(userId) && rooms[roomId]) {
    delete rooms[roomId].users[userId];
    delete rooms[roomId].signals[userId];
    if (Object.keys(rooms[roomId].users).length === 0) {
      delete rooms[roomId];
    }
  }
  res.json({ success: true });
});

module.exports = router;
