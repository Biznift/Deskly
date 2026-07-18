import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { createRegistry } from "./registry.js";
import { createRateLimiter } from "./rateLimit.js";
import { buildIceConfig } from "./ice.js";
import { loadDefaultEnv } from "./loadEnv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDefaultEnv(__dirname);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = Number(process.env.PORT) || 8080;
const PENDING_TIMEOUT_MS = Number(process.env.PENDING_TIMEOUT_MS) || 60_000;

const registry = createRegistry();
const rateLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 60_000 });

/** @type {WeakMap<import('ws').WebSocket, { role: 'host' | 'controller', hostId?: string }>} */
const sockets = new WeakMap();

function send(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function mimeType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  let pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mimeType(filePath) });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  sockets.set(ws, { role: "controller" });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      send(ws, { type: "error", code: "bad_json", message: "Invalid JSON" });
      return;
    }

    switch (msg.type) {
      case "register":
        handleRegister(ws, msg);
        break;
      case "connect":
        handleConnect(ws, msg);
        break;
      case "accept":
        handleAccept(ws, msg);
        break;
      case "reject":
        handleReject(ws, msg);
        break;
      case "offer":
      case "answer":
      case "ice":
        handleRelay(ws, msg);
        break;
      case "disconnect":
        handleDisconnect(ws, { unregisterHost: false });
        break;
      default:
        send(ws, {
          type: "error",
          code: "unknown_type",
          message: `Unknown type: ${msg.type}`,
        });
    }
  });

  ws.on("close", () => {
    handleDisconnect(ws, { silent: true, unregisterHost: true });
  });
});

function handleRegister(ws, msg) {
  const id = String(msg.id ?? "").replace(/\D/g, "");
  if (!/^\d{9}$/.test(id)) {
    send(ws, {
      type: "error",
      code: "invalid_id",
      message: "Host ID must be exactly 9 digits",
    });
    return;
  }

  const result = registry.register(id, ws);
  if (!result.ok) {
    send(ws, {
      type: "error",
      code: result.error,
      message: "This ID is already registered by another host",
    });
    return;
  }

  sockets.set(ws, { role: "host", hostId: id });
  send(ws, { type: "registered", id });
}

function handleConnect(ws, msg) {
  const id = String(msg.id ?? "").replace(/\D/g, "");
  if (!/^\d{9}$/.test(id)) {
    send(ws, {
      type: "error",
      code: "invalid_id",
      message: "Host ID must be exactly 9 digits",
    });
    return;
  }

  const limit = rateLimiter.check(id);
  if (!limit.allowed) {
    send(ws, {
      type: "error",
      code: "rate_limited",
      message: "Too many connection attempts. Try again shortly.",
      retryAfterMs: limit.retryAfterMs,
    });
    return;
  }
  rateLimiter.record(id);

  const entry = registry.get(id);
  if (!entry || entry.ws.readyState !== 1) {
    send(ws, {
      type: "error",
      code: "host_offline",
      message: "Host is offline or unknown",
    });
    return;
  }

  if (entry.sessionActive || entry.pending) {
    send(ws, {
      type: "error",
      code: "host_busy",
      message: "Host is already in a session or has a pending request",
    });
    return;
  }

  const requestId = randomUUID();
  const timeout = setTimeout(() => {
    const current = registry.get(id);
    if (!current?.pending || current.pending.requestId !== requestId) return;
    send(current.pending.controllerWs, {
      type: "timeout",
      message: "Host did not accept in time",
    });
    send(current.ws, {
      type: "request_expired",
      requestId,
    });
    current.pending = null;
  }, PENDING_TIMEOUT_MS);

  entry.pending = {
    requestId,
    controllerWs: ws,
    timeout,
    forceRelay: Boolean(msg.forceRelay),
  };
  sockets.set(ws, { role: "controller", hostId: id });

  send(ws, {
    type: "waiting",
    requestId,
    message: "Waiting for host to accept…",
  });
  send(entry.ws, {
    type: "connection_request",
    requestId,
    forceRelay: Boolean(msg.forceRelay),
  });
}

function handleAccept(ws, msg) {
  const meta = sockets.get(ws);
  if (!meta || meta.role !== "host" || !meta.hostId) {
    send(ws, {
      type: "error",
      code: "not_host",
      message: "Only the host can accept",
    });
    return;
  }

  const entry = registry.get(meta.hostId);
  if (!entry?.pending || entry.pending.requestId !== msg.requestId) {
    send(ws, {
      type: "error",
      code: "no_pending",
      message: "No matching pending request",
    });
    return;
  }

  clearTimeout(entry.pending.timeout);
  const forceRelay = entry.pending.forceRelay;
  entry.controllerWs = entry.pending.controllerWs;
  entry.pending = null;
  entry.sessionActive = true;

  const ice = buildIceConfig({ forceRelay });
  const payload = {
    type: "accepted",
    iceServers: ice.iceServers,
    ...(ice.iceTransportPolicy
      ? { iceTransportPolicy: ice.iceTransportPolicy }
      : {}),
  };
  send(entry.controllerWs, payload);
  send(entry.ws, payload);
}

function handleReject(ws, msg) {
  const meta = sockets.get(ws);
  if (!meta || meta.role !== "host" || !meta.hostId) {
    send(ws, {
      type: "error",
      code: "not_host",
      message: "Only the host can reject",
    });
    return;
  }

  const entry = registry.get(meta.hostId);
  if (!entry?.pending || entry.pending.requestId !== msg.requestId) {
    send(ws, {
      type: "error",
      code: "no_pending",
      message: "No matching pending request",
    });
    return;
  }

  clearTimeout(entry.pending.timeout);
  send(entry.pending.controllerWs, {
    type: "rejected",
    message: "Host rejected the connection",
  });
  entry.pending = null;
  send(entry.ws, { type: "rejected", requestId: msg.requestId });
}

function handleRelay(ws, msg) {
  const meta = sockets.get(ws);
  if (!meta?.hostId) {
    send(ws, {
      type: "error",
      code: "not_in_session",
      message: "Not associated with a host session",
    });
    return;
  }

  const entry = registry.get(meta.hostId);
  if (!entry?.sessionActive || !entry.controllerWs) {
    send(ws, {
      type: "error",
      code: "not_accepted",
      message: "Relay only allowed after host accepts",
    });
    return;
  }

  const peer = meta.role === "host" ? entry.controllerWs : entry.ws;
  if (!peer || peer.readyState !== 1) {
    send(ws, {
      type: "error",
      code: "peer_gone",
      message: "Peer disconnected",
    });
    return;
  }

  // Forward signaling payload as-is (offer / answer / ice).
  send(peer, msg);
}

function handleDisconnect(
  ws,
  { silent = false, unregisterHost = false } = {},
) {
  const meta = sockets.get(ws);
  if (!meta?.hostId) return;

  const entry = registry.get(meta.hostId);
  if (!entry) return;

  if (meta.role === "host") {
    if (entry.pending) {
      clearTimeout(entry.pending.timeout);
      send(entry.pending.controllerWs, {
        type: "session_ended",
        reason: "host_disconnected",
      });
      entry.pending = null;
    }
    if (entry.controllerWs) {
      send(entry.controllerWs, {
        type: "session_ended",
        reason: "host_disconnected",
      });
      entry.controllerWs = null;
    }
    entry.sessionActive = false;

    if (unregisterHost) {
      registry.unregisterIfMatch(meta.hostId, ws);
    } else if (!silent) {
      send(ws, { type: "session_ended", reason: "disconnected" });
    }
    return;
  }

  // Controller left
  if (entry.pending?.controllerWs === ws) {
    clearTimeout(entry.pending.timeout);
    send(entry.ws, {
      type: "request_cancelled",
      requestId: entry.pending.requestId,
    });
    entry.pending = null;
    return;
  }

  if (entry.controllerWs === ws) {
    entry.controllerWs = null;
    entry.sessionActive = false;
    send(entry.ws, {
      type: "session_ended",
      reason: "controller_disconnected",
    });
    if (!silent) {
      send(ws, { type: "session_ended", reason: "disconnected" });
    }
  }
}

server.listen(PORT, () => {
  const ice = buildIceConfig();
  const hasTurn = ice.iceServers.some(
    (s) =>
      (typeof s.urls === "string" && s.urls.startsWith("turn:")) ||
      (Array.isArray(s.urls) && s.urls.some((u) => u.startsWith("turn:"))),
  );
  console.log(`Deskly signaling listening on http://localhost:${PORT}`);
  console.log(`ICE: STUN${hasTurn ? " + TURN" : " only (set TURN_URLS + TURN_SECRET for relay)"}`);
  console.log(`Open http://localhost:${PORT}/controller.html  → Viewer`);
  console.log(`Controller app: http://localhost:3000`);
});
