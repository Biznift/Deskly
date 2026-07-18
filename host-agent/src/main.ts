import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createHostPeer, formatId, randomHostId } from "./webrtc";
import { hideSessionOverlay, showSessionOverlay } from "./sessionOverlay";

const hostIdEl = document.querySelector<HTMLElement>("#hostId")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const signalUrlEl = document.querySelector<HTMLInputElement>("#signalUrl")!;
const reconnectBtn = document.querySelector<HTMLButtonElement>("#reconnectBtn")!;
const incomingEl = document.querySelector<HTMLElement>("#incoming")!;
const sessionEl = document.querySelector<HTMLElement>("#session")!;
const sessionHintEl = document.querySelector<HTMLElement>("#sessionHint")!;
const acceptBtn = document.querySelector<HTMLButtonElement>("#acceptBtn")!;
const rejectBtn = document.querySelector<HTMLButtonElement>("#rejectBtn")!;
const disconnectBtn =
  document.querySelector<HTMLButtonElement>("#disconnectBtn")!;

const hostId = randomHostId();
hostIdEl.textContent = formatId(hostId);

let ws: WebSocket | null = null;
let peer: ReturnType<typeof createHostPeer> | null = null;
let pendingRequestId: string | null = null;
let sessionLive = false;

function setStatus(text: string) {
  statusEl.textContent = text;
}

function connectSignaling() {
  void endSession({ notifySignaling: false, reason: "reconnect" });
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }

  const url = signalUrlEl.value.trim() || "ws://127.0.0.1:8080";
  setStatus(`Connecting to ${url}…`);
  ws = new WebSocket(url);

  ws.onopen = () => {
    ws!.send(JSON.stringify({ type: "register", id: hostId }));
  };

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(String(ev.data));

    switch (msg.type) {
      case "registered":
        setStatus("Online — share your ID, then Accept when asked.");
        break;

      case "connection_request":
        pendingRequestId = msg.requestId;
        incomingEl.classList.remove("hidden");
        setStatus("Incoming connection request.");
        break;

      case "accepted":
        incomingEl.classList.add("hidden");
        sessionEl.classList.remove("hidden");
        setStatus("Accepted — pick a screen to share…");
        try {
          await startStreaming(
            msg.iceServers ?? [],
            msg.iceTransportPolicy,
          );
          sessionLive = true;
          setStatus("Streaming + remote input enabled.");
          sessionHintEl.textContent =
            "Overlay shows “Being controlled”. Disconnect anytime.";
          await showSessionOverlay();
        } catch (err) {
          console.error(err);
          setStatus(
            "Screen capture cancelled or failed. Session closed — try Accept again.",
          );
          await endSession({ notifySignaling: true, reason: "capture_failed" });
        }
        break;

      case "rejected":
      case "request_expired":
      case "request_cancelled":
        pendingRequestId = null;
        incomingEl.classList.add("hidden");
        setStatus("Request cleared. Waiting for the next connection.");
        break;

      case "offer":
      case "answer":
      case "ice":
        await peer?.handleSignal(msg);
        break;

      case "session_ended":
        await endSession({
          notifySignaling: false,
          reason: msg.reason ?? "remote",
        });
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
    setStatus("Disconnected from signaling. Click Reconnect.");
    void endSession({ notifySignaling: false, reason: "signaling_closed" });
    incomingEl.classList.add("hidden");
  };

  ws.onerror = () => {
    setStatus("Signaling error — is the server running on port 8080?");
  };
}

async function startStreaming(
  iceServers: RTCIceServer[],
  iceTransportPolicy?: RTCIceTransportPolicy,
) {
  teardownPeer();
  peer = createHostPeer(iceServers, iceTransportPolicy);
  peer.setOnSignal((payload) => {
    ws?.send(JSON.stringify(payload));
  });
  peer.setOnInput((raw) => {
    void handleIncomingInput(raw);
  });
  peer.setOnChannelOpen(() => {
    void sendScreenInfo();
  });
  // WebRTC media is DTLS-SRTP by default; never disable encryption.
  await peer.startScreenShareAndOffer();
}

async function sendScreenInfo() {
  try {
    const info = await invoke<{ width: number; height: number }>(
      "get_screen_info",
    );
    peer?.send({ type: "screen_info", width: info.width, height: info.height });
  } catch (err) {
    console.warn("get_screen_info failed", err);
    peer?.send({
      type: "screen_info",
      width: window.screen.width,
      height: window.screen.height,
    });
  }
}

async function handleIncomingInput(raw: string) {
  if (!sessionLive) return;
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  if (!event || typeof event.type !== "string") return;
  if (event.type === "screen_info") return;

  try {
    await invoke("inject_remote_event", { event });
  } catch (err) {
    console.warn("inject failed", event.type, err);
  }
}

function teardownPeer() {
  peer?.close();
  peer = null;
}

async function endSession(opts: {
  notifySignaling: boolean;
  reason: string;
}) {
  const wasLive = sessionLive || peer !== null;
  sessionLive = false;
  pendingRequestId = null;
  teardownPeer();
  sessionEl.classList.add("hidden");
  incomingEl.classList.add("hidden");
  await hideSessionOverlay();

  if (opts.notifySignaling && wasLive && ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: "disconnect" }));
    } catch {
      /* ignore */
    }
  }
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
  setStatus("Rejected. Waiting for the next connection.");
});

async function hostDisconnect() {
  await endSession({ notifySignaling: true, reason: "host_disconnect" });
  setStatus("Disconnected. Still registered — waiting for next request.");
}

disconnectBtn.addEventListener("click", () => {
  void hostDisconnect();
});

void listen("deskly-host-disconnect", () => {
  void hostDisconnect();
});

reconnectBtn.addEventListener("click", () => connectSignaling());

connectSignaling();
