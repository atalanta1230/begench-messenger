const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { initDB } = require('./db');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const messagesRoutes = require('./routes/messages');
const filesRoutes = require('./routes/files');
const { socketHandler } = require('./socket');
const { authMiddleware } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', authMiddleware, express.static(UPLOADS_DIR));

app.use('/api/auth', authRoutes);
app.use('/api/users', authMiddleware, usersRoutes);
app.use('/api/messages', authMiddleware, messagesRoutes);
app.use('/api/files', authMiddleware, filesRoutes);

socketHandler(io);

initDB();
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
