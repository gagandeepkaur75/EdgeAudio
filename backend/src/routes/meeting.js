const express = require('express');
const router = express.Router();

// In-memory room state: { [meetingId]: { users: { [userId]: { lastSeen, role } }, signals: { [targetUserId]: [signals] } } }
const rooms = {};

// Clean up inactive rooms/users older than 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of Object.entries(rooms)) {
    for (const [userId, user] of Object.entries(room.users)) {
      if (now - user.lastSeen > 30000) { // 30s timeout
        delete room.users[userId];
        delete room.signals[userId];
      }
    }
    if (Object.keys(room.users).length === 0) {
      delete rooms[roomId];
    }
  }
}, 10000);

/**
 * Join / Heartbeat in a meeting room
 */
router.post('/join', (req, res) => {
  const { meetingId, userId, role } = req.body;
  if (!meetingId || !userId) {
    return res.status(400).json({ error: 'meetingId and userId are required' });
  }

  const cleanRoomId = meetingId.toUpperCase();
  if (!rooms[cleanRoomId]) {
    rooms[cleanRoomId] = { users: {}, signals: {} };
  }

  const room = rooms[cleanRoomId];
  room.users[userId] = {
    userId,
    role: role || 'peer',
    joinedAt: room.users[userId]?.joinedAt || Date.now(),
    lastSeen: Date.now(),
  };

  if (!room.signals[userId]) {
    room.signals[userId] = [];
  }

  const participantList = Object.values(room.users);
  res.json({
    success: true,
    meetingId: cleanRoomId,
    participantCount: participantList.length,
    participants: participantList,
  });
});

/**
 * Poll for room state and incoming WebRTC signals
router.get('/:meetingId/poll', (req, res) => {
  const { meetingId } = req.params;
  const { userId, role } = req.query;

  if (!meetingId || !userId) {
    return res.status(400).json({ error: 'meetingId and userId are required' });
  }

  const cleanRoomId = meetingId.toUpperCase();
  if (!rooms[cleanRoomId]) {
    rooms[cleanRoomId] = { users: {}, signals: {} };
  }

  const room = rooms[cleanRoomId];
  if (!room.users[userId]) {
    room.users[userId] = {
      userId,
      role: role || 'peer',
      joinedAt: Date.now(),
      lastSeen: Date.now(),
    };
    if (!room.signals[userId]) room.signals[userId] = [];
  } else {
    room.users[userId].lastSeen = Date.now();
  }

  // Pop signals for this user
  const incomingSignals = room.signals[userId] || [];
  room.signals[userId] = []; // clear after reading

  const activeParticipants = Object.values(room.users);

  res.json({
    participantCount: activeParticipants.length,
    participants: activeParticipants,
    signals: incomingSignals,
  });
});

/**
 * Send WebRTC signal (Offer, Answer, or ICE candidate) to peer
 */
router.post('/signal', (req, res) => {
  const { meetingId, senderId, targetId, signalData } = req.body;
  if (!meetingId || !senderId || !signalData) {
    return res.status(400).json({ error: 'meetingId, senderId, and signalData are required' });
  }

  const cleanRoomId = meetingId.toUpperCase();
  const room = rooms[cleanRoomId];

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  // If targetId is provided, deliver to specific user; otherwise broadcast to all other users
  const targets = targetId ? [targetId] : Object.keys(room.users).filter((id) => id !== senderId);

  for (const tid of targets) {
    if (!room.signals[tid]) room.signals[tid] = [];
    room.signals[tid].push({
      senderId,
      signalData,
      timestamp: Date.now(),
    });
  }

  res.json({ success: true });
});

/**
 * Leave meeting room
 */
router.post('/leave', (req, res) => {
  const { meetingId, userId } = req.body;
  if (meetingId && userId) {
    const cleanRoomId = meetingId.toUpperCase();
    if (rooms[cleanRoomId]) {
      delete rooms[cleanRoomId].users[userId];
      delete rooms[cleanRoomId].signals[userId];
      if (Object.keys(rooms[cleanRoomId].users).length === 0) {
        delete rooms[cleanRoomId];
      }
    }
  }
  res.json({ success: true });
});

module.exports = router;
