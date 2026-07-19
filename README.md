# Deskly

Lightweight remote desktop — screen view + mouse/keyboard only (AnyDesk-style ID + Accept).

## Components

| Path | Role |
|------|------|
| [`signaling/`](signaling/) | WebSocket signaling (register, Accept/Reject, ICE/TURN) |
| [`host-agent/`](host-agent/) | Tauri app — your ID + connect to remote ID |
| [`controller/`](controller/) | Optional Next.js web controller |
| [`turn/`](turn/) | coturn Docker config (optional TURN) |

## Quick start (same PC)

```bash
# 1. Signaling
cd signaling && npm install && npm start

# 2. Deskly desktop app
cd host-agent && npm install && npm run tauri:dev
```

- Share **Your ID**, or enter a remote ID under **Remote Desk → Connect**
- Host must **Accept** before screen share starts

Web controller (optional): `cd controller && npm run dev` → http://localhost:3000

## Two devices (same Wi‑Fi)

1. On PC A run signaling + Deskly  
2. Note PC A LAN IP (e.g. `192.168.0.103`)  
3. On PC B open Deskly → Advanced → `ws://192.168.0.103:8080` → Reconnect  
4. Connect using the other machine’s ID → Accept  

## Build installers

### Windows → `.exe`

```bash
cd host-agent
npm run tauri:build
```

### macOS → `.dmg` (must build on a Mac)

```bash
cd host-agent
npm install
npm run tauri:build
```

See [`host-agent/README.md`](host-agent/README.md) for output paths and macOS permissions.

## TURN (optional)

See [`turn/README.md`](turn/README.md). Set `TURN_URLS` / `TURN_SECRET` in `signaling/.env`.
