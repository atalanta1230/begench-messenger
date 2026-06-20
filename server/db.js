const Datastore = require('@seald-io/nedb');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const path = require('path');

const DB_DIR = path.join(__dirname, 'data');
require('fs').mkdirSync(DB_DIR, { recursive: true });

const users = new Datastore({ filename: path.join(DB_DIR, 'users.db'), autoload: true });
const chats = new Datastore({ filename: path.join(DB_DIR, 'chats.db'), autoload: true });
const members = new Datastore({ filename: path.join(DB_DIR, 'members.db'), autoload: true });
const messages = new Datastore({ filename: path.join(DB_DIR, 'messages.db'), autoload: true });

users.ensureIndex({ fieldName: 'username', unique: true });
members.ensureIndex({ fieldName: 'chatId' });
messages.ensureIndex({ fieldName: 'chatId' });

async function initDB() {
  const admin = await users.findOneAsync({ role: 'admin' });
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    await users.insertAsync({
      _id: randomUUID(), username: 'admin', password: hash,
      role: 'admin', status: 'approved', avatar: null,
      createdAt: Date.now()
    });
    console.log('Admin created: login=admin password=admin123');
  }
}

module.exports = { users, chats, members, messages, initDB };
