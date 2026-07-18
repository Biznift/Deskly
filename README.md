# Deskly

Lightweight remote desktop control — screen view + mouse/keyboard only.

## Components

| Path | Role |
|------|------|
| `signaling/` | WebSocket signaling (ID + Accept/Reject, ICE/TURN config) |
| `host-agent/` | Tauri host app (share screen, inject input, disconnect overlay) |
| `controller/` | Next.js controller (connect by host ID) |
| `turn/` | coturn Docker config for TURN fallback |

## Quick start (local)

```bash
# 1. Signaling
cd signaling && npm install && npm start

# 2. Controller
cd controller && npm install && npm run dev

# 3. Host
cd host-agent && npm install && npm run tauri dev
```

- Signaling: http://localhost:8080  
- Controller: http://localhost:3000  
- Host shows a 9-digit ID → controller connects → host **Accepts**

## TURN (optional)

See [`turn/README.md`](turn/README.md). Set matching `TURN_URLS` / `TURN_SECRET` in `signaling/.env`.
