const router = require('express').Router();
const { randomUUID } = require('crypto');
const { users, chats, members } = require('../db');
const { adminOnly } = require('../middleware/auth');

router.get('/', async (req, res) => {
  const all = await users.findAsync({}).projection({ password: 0 });
  res.json(all.map(u => ({ id: u._id, username: u.username, role: u.role, status: u.status, avatar: u.avatar })));
});

router.get('/pending', adminOnly, async (req, res) => {
  const pending = await users.findAsync({ status: 'pending' }).projection({ password: 0 });
  res.json(pending.map(u => ({ id: u._id, username: u.username, createdAt: u.createdAt })));
});

router.post('/:id/approve', adminOnly, async (req, res) => {
  await users.updateAsync({ _id: req.params.id }, { $set: { status: 'approved' } });
  res.json({ message: 'User approved' });
});

router.post('/:id/reject', adminOnly, async (req, res) => {
  await users.updateAsync({ _id: req.params.id }, { $set: { status: 'rejected' } });
  res.json({ message: 'User rejected' });
});

router.delete('/:id', adminOnly, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  await users.removeAsync({ _id: req.params.id });
  res.json({ message: 'User deleted' });
});

router.post('/chats/direct/:userId', async (req, res) => {
  const myId = req.user.id;
  const otherId = req.params.userId;

  const myChats = await members.findAsync({ userId: myId });
  const myChatIds = myChats.map(m => m.chatId);

  const otherChats = await members.findAsync({ userId: otherId });
  const otherChatIds = otherChats.map(m => m.chatId);

  const commonIds = myChatIds.filter(id => otherChatIds.includes(id));
  if (commonIds.length > 0) {
    const existing = await chats.findOneAsync({ _id: { $in: commonIds }, type: 'direct' });
    if (existing) return res.json({ chatId: existing._id });
  }

  const chatId = randomUUID();
  await chats.insertAsync({ _id: chatId, type: 'direct', name: null, createdAt: Date.now() });
  await members.insertAsync({ chatId, userId: myId });
  await members.insertAsync({ chatId, userId: otherId });
  res.json({ chatId });
});

module.exports = router;
