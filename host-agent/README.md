# Deskly Host Agent

Tauri desktop app — AnyDesk-style **This Desk** (your ID) + **Remote Desk** (connect to another ID).

## Develop

```bash
# Terminal 1 — signaling
cd ../signaling && npm install && npm start

# Terminal 2 — app
cd ../host-agent
npm install
npm run tauri:dev
```

## Build

### Windows (produces `.exe` / NSIS installer)

```bash
npm install
npm run tauri:build
```

Outputs (typical):

- `src-tauri/target/release/host-agent.exe`
- `src-tauri/target/release/bundle/nsis/Deskly_*-setup.exe`

### macOS (produces `.app` / `.dmg`) — run on a Mac

Prerequisites:

- Xcode Command Line Tools: `xcode-select --install`
- Node.js + Rust (`rustup`)

```bash
npm install
npm run tauri:build
```

Outputs (typical):

- `src-tauri/target/release/bundle/macos/Deskly.app`
- `src-tauri/target/release/bundle/dmg/Deskly_*.dmg`

After install, grant **Screen Recording** and **Accessibility** for Deskly under  
System Settings → Privacy & Security.

## Signaling URL

- Same machine: `ws://127.0.0.1:8080`
- Another device on Wi‑Fi: `ws://<host-pc-lan-ip>:8080` (open Advanced in the app)

You cannot build a macOS `.dmg` on Windows, or a Windows `.exe` on macOS, with a normal Tauri setup — build each platform on that OS.
