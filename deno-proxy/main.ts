const SECRET = Deno.env.get("TUNNEL_SECRET");
if (!SECRET) throw new Error("TUNNEL_SECRET не задан!");

let homeWs: WebSocket | null = null;
const pending = new Map<string, (msg: Record<string, unknown>) => void>();
const browserSockets = new Map<string, WebSocket>();

Deno.serve((req: Request) => {
  const url = new URL(req.url);

  // Подключение домашнего сервера
  if (url.pathname === "/_tunnel") {
    if (req.headers.get("x-secret") !== SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);

    const pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);

    socket.onopen = () => {
      homeWs = socket;
      console.log("Домашний сервер подключён");
    };

    socket.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "pong") return;

        // Сообщение WebSocket от локального сервера к браузеру
        if (msg.type === "ws_msg") {
          const bs = browserSockets.get(msg.id);
          if (bs?.readyState === WebSocket.OPEN) {
            if (msg.binary) {
              const bytes = Uint8Array.from(atob(msg.data as string), (c) => c.charCodeAt(0));
              bs.send(bytes);
            } else {
              bs.send(msg.data as string);
            }
          }
          return;
        }

        if (msg.type === "ws_close") {
          const bs = browserSockets.get(msg.id);
          if (bs) {
            try { bs.close((msg.code as number) || 1000, (msg.reason as string) || ""); } catch (_) {}
            browserSockets.delete(msg.id);
          }
          return;
        }

        // HTTP ответ
        const resolve = pending.get(msg.id as string);
        if (resolve) {
          pending.delete(msg.id as string);
          resolve(msg);
        }
      } catch (_) {}
    };

    socket.onclose = () => {
      clearInterval(pingInterval);
      homeWs = null;
      for (const [, bs] of browserSockets) {
        try { bs.close(1001, "Tunnel disconnected"); } catch (_) {}
      }
      browserSockets.clear();
      console.log("Домашний сервер отключился");
    };

    socket.onerror = () => {
      clearInterval(pingInterval);
      homeWs = null;
    };

    return response;
  }

  if (!homeWs || homeWs.readyState !== WebSocket.OPEN) {
    return new Response("Сервер временно недоступен", { status: 503 });
  }

  // WebSocket upgrade (socket.io, etc.)
  if (req.headers.get("upgrade") === "websocket") {
    const { socket: bs, response } = Deno.upgradeWebSocket(req);
    const wsId = crypto.randomUUID();

    bs.onopen = () => {
      browserSockets.set(wsId, bs);
      homeWs!.send(JSON.stringify({
        type: "create_ws",
        id: wsId,
        url: url.pathname + url.search,
        headers: Object.fromEntries(req.headers.entries()),
      }));
    };

    bs.onmessage = (e) => {
      if (!homeWs || homeWs.readyState !== WebSocket.OPEN) return;
      if (typeof e.data === "string") {
        homeWs.send(JSON.stringify({ type: "ws_msg", id: wsId, data: e.data, binary: false }));
      } else {
        const arr = new Uint8Array(e.data as ArrayBuffer);
        homeWs.send(JSON.stringify({
          type: "ws_msg", id: wsId,
          data: btoa(String.fromCharCode(...arr)),
          binary: true,
        }));
      }
    };

    bs.onclose = () => {
      browserSockets.delete(wsId);
      if (homeWs?.readyState === WebSocket.OPEN) {
        homeWs.send(JSON.stringify({ type: "ws_close", id: wsId }));
      }
    };

    return response;
  }

  // Обычный HTTP запрос
  return new Promise<Response>(async (resolve) => {
    const id = crypto.randomUUID();

    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(new Response("Timeout", { status: 504 }));
    }, 25000);

    const bodyBuf = await req.arrayBuffer();
    const bodyB64 = bodyBuf.byteLength > 0
      ? btoa(String.fromCharCode(...new Uint8Array(bodyBuf)))
      : "";

    pending.set(id, (msg) => {
      clearTimeout(timer);
      const skip = new Set(["transfer-encoding", "connection", "keep-alive", "upgrade"]);
      const headers = new Headers();
      for (const [k, v] of Object.entries((msg.headers as Record<string, string>) || {})) {
        if (!skip.has(k.toLowerCase())) {
          try { headers.set(k, v); } catch (_) {}
        }
      }
      const body = msg.body
        ? Uint8Array.from(atob(msg.body as string), (c) => c.charCodeAt(0))
        : new Uint8Array(0);
      resolve(new Response(body, { status: (msg.status as number) || 200, headers }));
    });

    homeWs!.send(JSON.stringify({
      id,
      method: req.method,
      url: url.pathname + url.search,
      headers: Object.fromEntries(req.headers.entries()),
      body: bodyB64,
    }));
  });
});
