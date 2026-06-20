const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { users } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const total = await users.countAsync({});
    if (total >= 10) return res.status(400).json({ error: 'Max 10 users reached' });

    const hash = bcrypt.hashSync(password, 10);
    await users.insertAsync({
      _id: randomUUID(), username, password: hash,
      role: 'user', status: 'pending', avatar: null, createdAt: Date.now()
    });
    res.json({ message: 'Registration sent. Wait for admin approval.' });
  } catch (e) {
    if (e.errorType === 'uniqueViolated') return res.status(400).json({ error: 'Username taken' });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await users.findOneAsync({ username });
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Wrong credentials' });
  if (user.status === 'pending') return res.status(403).json({ error: 'Waiting for admin approval' });
  if (user.status === 'rejected') return res.status(403).json({ error: 'Access denied' });

  const token = jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    JWT_SECRET, { expiresIn: '30d' }
  );
  res.json({ token, user: { id: user._id, username: user.username, role: user.role, avatar: user.avatar } });
});

module.exports = router;
