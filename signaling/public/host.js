import {
  wsUrl,
  createHostVideoPeer,
  randomHostId,
  formatId,
} from "./webrtc.js";

const hostIdEl = document.getElementById("hostId");
const statusEl = document.getElementById("status");
const incomingEl = document.getElementById("incoming");
const sessionEl = document.getElementById("session");
const logEl = document.getElementById("log");
const acceptBtn = document.getElementById("acceptBtn");
const rejectBtn = document.getElementById("rejectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");

const hostId = randomHostId();
hostIdEl.textContent = formatId(hostId);

/** @type {WebSocket | null} */
let ws = null;
/** @type {ReturnType<typeof createHostVideoPeer> | null} */
let peer = null;
/** @type {string | null} */
let pendingRequestId = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function log(line) {
  if (!logEl) return;
  logEl.textContent += `${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function connectWs() {
  ws = new WebSocket(wsUrl());

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "register", id: hostId }));
  };

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);

    switch (msg.type) {
      case "registered":
        setStatus("Online — share this ID with the controller.");
        break;

      case "connection_request":
        pendingRequestId = msg.requestId;
        incomingEl.classList.remove("hidden");
        setStatus("Someone wants to connect.");
        break;

      case "accepted":
        incomingEl.classList.add("hidden");
        sessionEl.classList.remove("hidden");
        setStatus("Accepted — pick a screen to share…");
        try {
          await startPeer(msg.iceServers, msg.iceTransportPolicy);
          setStatus("Streaming screen.");
          log("Screen share started");
        } catch (err) {
          console.error(err);
          setStatus("Screen capture cancelled or failed.");
          ws?.send(JSON.stringify({ type: "disconnect" }));
          sessionEl.classList.add("hidden");
          teardownPeer();
        }
        break;

      case "rejected":
      case "request_expired":
      case "request_cancelled":
        pendingRequestId = null;
        incomingEl.classList.add("hidden");
        setStatus("Request cleared. Waiting for next connection.");
        break;

      case "offer":
      case "answer":
      case "ice":
        await peer?.handleSignal(msg);
        break;

      case "session_ended":
        teardownPeer();
        sessionEl.classList.add("hidden");
        incomingEl.classList.add("hidden");
        pendingRequestId = null;
        setStatus(`Session ended (${msg.reason ?? "unknown"}). Still online.`);
        break;

      case "error":
        setStatus(`Error: ${msg.message}`);
        break;

      default:
        break;
    }
  };

  ws.onclose = () => {
    setStatus("Disconnected from signaling. Refresh to reconnect.");
    teardownPeer();
  };
}

async function startPeer(iceServers, iceTransportPolicy) {
  teardownPeer();
  peer = createHostVideoPeer({ iceServers, iceTransportPolicy });
  peer.setOnSignal((payload) => {
    ws?.send(JSON.stringify(payload));
  });
  await peer.startScreenShareAndOffer();
}

function teardownPeer() {
  peer?.close();
  peer = null;
  if (logEl) logEl.textContent = "";
}

acceptBtn.addEventListener("click", () => {
  if (!pendingRequestId || !ws) return;
  ws.send(JSON.stringify({ type: "accept", requestId: pendingRequestId }));
  pendingRequestId = null;
});

rejectBtn.addEventListener("click", () => {
  if (!pendingRequestId || !ws) return;
  ws.send(JSON.stringify({ type: "reject", requestId: pendingRequestId }));
  pendingRequestId = null;
  incomingEl.classList.add("hidden");
  setStatus("Rejected. Waiting for next connection.");
});

disconnectBtn.addEventListener("click", () => {
  ws?.send(JSON.stringify({ type: "disconnect" }));
  teardownPeer();
  sessionEl.classList.add("hidden");
  setStatus("Disconnected session. Still registered as host.");
});

connectWs();
