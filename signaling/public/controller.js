import {
  wsUrl,
  createViewerPeer,
  formatId,
  videoNormCoords,
} from "./webrtc.js";

const form = document.getElementById("connectForm");
const input = document.getElementById("hostIdInput");
const statusEl = document.getElementById("status");
const stageStatusEl = document.getElementById("stageStatus");
const disconnectBtn = document.getElementById("disconnectBtn");
const videoEl = document.getElementById("remoteVideo");

/** @type {WebSocket | null} */
let ws = null;
/** @type {ReturnType<typeof createViewerPeer> | null} */
let peer = null;
/** @type {{ width: number, height: number } | null} */
let hostScreen = null;
let inputBound = false;
let lastMoveSent = 0;

function setStatus(text) {
  statusEl.textContent = text;
  stageStatusEl.textContent = text;
}

function digitsOnly(value) {
  return String(value).replace(/\D/g, "");
}

function enterViewer() {
  document.body.classList.add("viewing");
}

function leaveViewer() {
  document.body.classList.remove("viewing");
  unbindInput();
}

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const id = digitsOnly(input.value);
  if (!/^\d{9}$/.test(id)) {
    setStatus("Enter a valid 9-digit host ID.");
    return;
  }
  const forceRelay = document.getElementById("forceRelay")?.checked;
  connect(id, Boolean(forceRelay));
});

function connect(hostId, forceRelay = false) {
  teardown();
  setStatus(`Connecting to ${formatId(hostId)}…`);
  ws = new WebSocket(wsUrl());

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "connect", id: hostId, forceRelay }));
  };

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);

    switch (msg.type) {
      case "waiting":
        setStatus("Waiting for host to accept…");
        break;

      case "accepted":
        setStatus(
          msg.iceTransportPolicy === "relay"
            ? "Accepted — TURN relay mode…"
            : "Accepted — waiting for screen offer…",
        );
        enterViewer();
        startPeer(msg.iceServers, msg.iceTransportPolicy);
        break;

      case "rejected":
        setStatus("Host rejected the connection.");
        teardown(false);
        break;

      case "timeout":
        setStatus("Host did not accept in time.");
        teardown(false);
        break;

      case "offer":
      case "answer":
      case "ice":
        await peer?.handleSignal(msg);
        if (msg.type === "offer") {
          setStatus("Receiving screen…");
        }
        break;

      case "session_ended":
        setStatus(`Session ended (${msg.reason ?? "unknown"}).`);
        teardown(false);
        break;

      case "error":
        setStatus(`Error: ${msg.message}`);
        teardown(false);
        break;

      default:
        break;
    }
  };

  ws.onclose = () => {
    if (document.body.classList.contains("viewing")) {
      setStatus("Signaling closed.");
    }
  };
}

function startPeer(iceServers, iceTransportPolicy) {
  peer = createViewerPeer({ iceServers, videoEl, iceTransportPolicy });
  peer.setOnSignal((payload) => {
    ws?.send(JSON.stringify(payload));
  });
  peer.setOnMessage((raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "screen_info") {
        hostScreen = { width: msg.width, height: msg.height };
        setStatus(`Live + control (${msg.width}×${msg.height})`);
      }
    } catch {
      /* ignore */
    }
  });
  peer.setOnChannelOpen(() => {
    bindInput();
    setStatus("Live + remote control ready — click the video");
  });
  peer.pc.onconnectionstatechange = () => {
    if (peer?.pc.connectionState === "connected") {
      setStatus("Live screen");
    }
  };
}

function sendInput(obj) {
  peer?.send(obj);
}

function coordsFromEvent(ev) {
  return videoNormCoords(videoEl, ev.clientX, ev.clientY);
}

function onPointerMove(ev) {
  if (!peer) return;
  const now = performance.now();
  if (now - lastMoveSent < 16) return;
  lastMoveSent = now;
  const { x, y } = coordsFromEvent(ev);
  sendInput({ type: "mousemove", x, y });
}

function onPointerDown(ev) {
  videoEl.setPointerCapture?.(ev.pointerId);
  videoEl.focus();
  const { x, y } = coordsFromEvent(ev);
  sendInput({ type: "mousedown", button: ev.button, x, y });
}

function onPointerUp(ev) {
  const { x, y } = coordsFromEvent(ev);
  sendInput({ type: "mouseup", button: ev.button, x, y });
}

function onWheel(ev) {
  ev.preventDefault();
  const { x, y } = coordsFromEvent(ev);
  sendInput({
    type: "wheel",
    deltaX: ev.deltaX,
    deltaY: ev.deltaY,
    x,
    y,
  });
}

function onKeyDown(ev) {
  if (!document.body.classList.contains("viewing")) return;
  // Allow refresh / disconnect shortcuts locally
  if (ev.key === "F5" || (ev.ctrlKey && ev.key === "r")) return;
  ev.preventDefault();
  sendInput({ type: "keydown", key: ev.key, code: ev.code });
}

function onKeyUp(ev) {
  if (!document.body.classList.contains("viewing")) return;
  if (ev.key === "F5" || (ev.ctrlKey && ev.key === "r")) return;
  ev.preventDefault();
  sendInput({ type: "keyup", key: ev.key, code: ev.code });
}

function onContextMenu(ev) {
  ev.preventDefault();
}

function bindInput() {
  if (inputBound) return;
  inputBound = true;
  videoEl.tabIndex = 0;
  videoEl.style.cursor = "none";
  videoEl.addEventListener("pointermove", onPointerMove);
  videoEl.addEventListener("pointerdown", onPointerDown);
  videoEl.addEventListener("pointerup", onPointerUp);
  videoEl.addEventListener("wheel", onWheel, { passive: false });
  videoEl.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
}

function unbindInput() {
  if (!inputBound) return;
  inputBound = false;
  videoEl.style.cursor = "";
  videoEl.removeEventListener("pointermove", onPointerMove);
  videoEl.removeEventListener("pointerdown", onPointerDown);
  videoEl.removeEventListener("pointerup", onPointerUp);
  videoEl.removeEventListener("wheel", onWheel);
  videoEl.removeEventListener("contextmenu", onContextMenu);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
}

function teardown(closeWs = true) {
  unbindInput();
  peer?.close();
  peer = null;
  hostScreen = null;
  leaveViewer();
  if (closeWs && ws) {
    try {
      ws.send(JSON.stringify({ type: "disconnect" }));
    } catch {
      /* ignore */
    }
    ws.close();
    ws = null;
  } else if (!closeWs) {
    ws?.close();
    ws = null;
  }
}

disconnectBtn.addEventListener("click", () => {
  teardown(true);
  setStatus("Disconnected.");
});
