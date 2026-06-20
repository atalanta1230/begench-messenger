const router = require('express').Router();
const { chats, members, messages, users } = require('../db');

router.get('/chats', async (req, res) => {
  const myMemberships = await members.findAsync({ userId: req.user.id });
  const chatIds = myMemberships.map(m => m.chatId);
  const myChats = await chats.findAsync({ _id: { $in: chatIds } });

  const result = await Promise.all(myChats.map(async chat => {
    const lastMsg = await messages.findAsync({ chatId: chat._id }).sort({ createdAt: -1 }).limit(1);
    let other = null;
    if (chat.type === 'direct') {
      const otherMember = await members.findOneAsync({ chatId: chat._id, userId: { $ne: req.user.id } });
      if (otherMember) {
        const otherUser = await users.findOneAsync({ _id: otherMember.userId });
        if (otherUser) other = { id: otherUser._id, username: otherUser.username, avatar: otherUser.avatar };
      }
    }
    return {
      id: chat._id, type: chat.type, name: chat.name, other,
      lastMessage: lastMsg[0]?.content || null,
      lastAt: lastMsg[0]?.createdAt || chat.createdAt
    };
  }));

  result.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  res.json(result);
});

router.get('/chat/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const member = await members.findOneAsync({ chatId, userId: req.user.id });
  if (!member) return res.status(403).json({ error: 'Not in this chat' });

  const msgs = await messages.findAsync({ chatId }).sort({ createdAt: 1 }).limit(100);
  const result = await Promise.all(msgs.map(async msg => {
    const sender = await users.findOneAsync({ _id: msg.senderId });
    return { ...msg, id: msg._id, username: sender?.username, avatar: sender?.avatar };
  }));
  res.json(result);
});

module.exports = router;
