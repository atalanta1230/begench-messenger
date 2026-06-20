require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');

const CLOUD_RUN_URL = process.env.CLOUD_RUN_URL;
const SECRET = process.env.TUNNEL_SECRET;
const LOCAL_PORT = parseInt(process.env.LOCAL_PORT || '80');

if (!CLOUD_RUN_URL || !SECRET) {
  console.error('Задай CLOUD_RUN_URL и TUNNEL_SECRET в .env файле');
  process.exit(1);
}

const wsConnections = new Map();

function forwardToLocal(msg) {
  return new Promise((resolve) => {
    const bodyBuf = Buffer.from(msg.body || '', 'base64');
    const headers = { ...msg.headers };
    headers['host'] = 'localhost';
    delete headers['x-forwarded-for'];
    delete headers['x-secret'];

    const options = {
      hostname: '127.0.0.1',
      port: LOCAL_PORT,
      path: msg.url,
      method: msg.method,
      headers,
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          id: msg.id,
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('base64'),
        });
      });
    });

    req.on('error', () => resolve({ id: msg.id, status: 502, headers: {}, body: '' }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ id: msg.id, status: 504, headers: {}, body: '' }); });

    if (bodyBuf.length > 0) req.write(bodyBuf);
    req.end();
  });
}

function createLocalWs(msg, tunnelWs) {
  const wsUrl = `ws://127.0.0.1:${LOCAL_PORT}${msg.url}`;
  const headers = { ...msg.headers, host: 'localhost' };
  delete headers['x-secret'];

  const localWs = new WebSocket(wsUrl, { headers });
  wsConnections.set(msg.id, localWs);

  localWs.on('message', (data, isBinary) => {
    if (tunnelWs.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      tunnelWs.send(JSON.stringify({ type: 'ws_msg', id: msg.id, data: data.toString('base64'), binary: true }));
    } else {
      tunnelWs.send(JSON.stringify({ type: 'ws_msg', id: msg.id, data: data.toString(), binary: false }));
    }
  });

  localWs.on('close', (code, reason) => {
    wsConnections.delete(msg.id);
    if (tunnelWs.readyState === WebSocket.OPEN) {
      tunnelWs.send(JSON.stringify({ type: 'ws_close', id: msg.id, code, reason: reason.toString() }));
    }
  });

  localWs.on('error', (err) => {
    console.error('Local WS error:', err.message);
    wsConnections.delete(msg.id);
  });
}

function connect() {
  const wsUrl = CLOUD_RUN_URL
    .replace(/\/+$/, '')
    .replace(/^https?/, (m) => m === 'https' ? 'wss' : 'ws');

  console.log('Подключаемся к Deno Deploy...');
  const ws = new WebSocket(wsUrl + '/_tunnel', {
    headers: { 'x-secret': SECRET },
  });

  ws.on('open', () => {
    console.log('Туннель активен!');
    for (const [, localWs] of wsConnections) {
      try { localWs.close(); } catch (_) {}
    }
    wsConnections.clear();
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }

      if (msg.type === 'create_ws') { createLocalWs(msg, ws); return; }

      if (msg.type === 'ws_msg') {
        const localWs = wsConnections.get(msg.id);
        if (localWs?.readyState === WebSocket.OPEN) {
          localWs.send(msg.binary ? Buffer.from(msg.data, 'base64') : msg.data);
        }
        return;
      }

      if (msg.type === 'ws_close') {
        const localWs = wsConnections.get(msg.id);
        if (localWs) { localWs.close(msg.code || 1000, msg.reason || ''); wsConnections.delete(msg.id); }
        return;
      }

      // HTTP запрос
      const response = await forwardToLocal(msg);
      ws.send(JSON.stringify(response));
    } catch (e) {
      console.error('Ошибка:', e.message);
    }
  });

  ws.on('close', (code) => {
    console.log(`Соединение закрыто (${code}). Переподключение через 3 сек...`);
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => console.error('WS ошибка:', err.message));
}

connect();
