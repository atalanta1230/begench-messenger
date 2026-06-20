const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { users, members, messages } = require('./db');
const { JWT_SECRET } = require('./middleware/auth');

const onlineUsers = new Map();

function socketHandler(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    try {
      socket.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    onlineUsers.set(userId, socket.id);
    io.emit('user:online', { userId, online: true });

    socket.on('chat:join', async (chatId) => {
      const member = await members.findOneAsync({ chatId, userId });
      if (member) socket.join(chatId);
    });

    socket.on('message:send', async (data) => {
      const { chatId, type, content, fileUrl, fileName } = data;
      const member = await members.findOneAsync({ chatId, userId });
      if (!member) return;

      const msgId = randomUUID();
      await messages.insertAsync({
        _id: msgId, chatId, senderId: userId,
        type: type || 'text', content, fileUrl, fileName,
        createdAt: Date.now()
      });

      const user = await users.findOneAsync({ _id: userId });
      io.to(chatId).emit('message:new', {
        id: msgId, chatId, sender_id: userId,
        username: user?.username, avatar: user?.avatar,
        type: type || 'text', content, file_url: fileUrl, file_name: fileName,
        created_at: Date.now()
      });
    });

    socket.on('call:start', (data) => {
      const { targetUserId, type, offer } = data;
      const targetSocket = onlineUsers.get(targetUserId);
      if (targetSocket) io.to(targetSocket).emit('call:incoming', {
        callerId: userId, callerName: socket.user.username, type, offer
      });
    });

    socket.on('call:answer', (data) => {
      const callerSocket = onlineUsers.get(data.callerId);
      if (callerSocket) io.to(callerSocket).emit('call:answered', { answer: data.answer });
    });

    socket.on('call:ice', (data) => {
      const targetSocket = onlineUsers.get(data.targetUserId);
      if (targetSocket) io.to(targetSocket).emit('call:ice', { candidate: data.candidate });
    });

    socket.on('call:end', (data) => {
      const targetSocket = onlineUsers.get(data.targetUserId);
      if (targetSocket) io.to(targetSocket).emit('call:ended');
    });

    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      io.emit('user:online', { userId, online: false });
    });
  });
}

module.exports = { socketHandler };
