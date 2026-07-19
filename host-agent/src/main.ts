import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createHostPeer,
  createViewerPeer,
  digitsOnly,
  formatId,
  randomHostId,
  videoNormCoords,
} from "./webrtc";
import { hideSessionOverlay, showSessionOverlay } from "./sessionOverlay";

const hostIdEl = document.querySelector<HTMLElement>("#hostId")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const signalUrlEl = document.querySelector<HTMLInputElement>("#signalUrl")!;
const reconnectBtn = document.querySelector<HTMLButtonElement>("#reconnectBtn")!;
const remoteForm = document.querySelector<HTMLFormElement>("#remoteForm")!;
const remoteIdInput =
  document.querySelector<HTMLInputElement>("#remoteIdInput")!;
const connectBtn = document.querySelector<HTMLButtonElement>("#connectBtn")!;
const incomingEl = document.querySelector<HTMLElement>("#incoming")!;
const sessionEl = document.querySelector<HTMLElement>("#session")!;
const sessionHintEl = document.querySelector<HTMLElement>("#sessionHint")!;
const acceptBtn = document.querySelector<HTMLButtonElement>("#acceptBtn")!;
const rejectBtn = document.querySelector<HTMLButtonElement>("#rejectBtn")!;
const disconnectHostBtn =
  document.querySelector<HTMLButtonElement>("#disconnectHostBtn")!;
const homeEl = document.querySelector<HTMLElement>("#home")!;
const viewerEl = document.querySelector<HTMLElement>("#viewer")!;
const viewerStatusEl = document.querySelector<HTMLElement>("#viewerStatus")!;
const remoteVideo = document.querySelector<HTMLVideoElement>("#remoteVideo")!;
const disconnectRemoteBtn =
  document.querySelector<HTMLButtonElement>("#disconnectRemoteBtn")!;

const myId = randomHostId();
hostIdEl.textContent = formatId(myId);

/** Always registered so others can connect to us (This Desk). */
let hostWs: WebSocket | null = null;
/** Outbound connection to someone else's ID (Remote Desk). */
let controlWs: WebSocket | null = null;

let hostPeer: ReturnType<typeof createHostPeer> | null = null;
let viewerPeer: ReturnType<typeof createViewerPeer> | null = null;
let pendingRequestId: string | null = null;
let hosting = false;
let controlling = false;
let inputBound = false;
let lastMoveSent = 0;
let controlSignalChain: Promise<void> = Promise.resolve();
const earlyControlSignals: Array<{
  type: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}> = [];

function setStatus(text: string) {
  statusEl.textContent = text;
}

function setViewerStatus(text: string) {
  viewerStatusEl.textContent = text;
}

function signalUrl() {
  return signalUrlEl.value.trim() || "ws://127.0.0.1:8080";
}

function busy() {
  return hosting || controlling || pendingRequestId !== null;
}

function formatRemoteInput(value: string) {
  const d = digitsOnly(value).slice(0, 9);
  remoteIdInput.value = d.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

// ——— This Desk: stay online ———

function connectHostSignaling() {
  void endHosting({ notify: false });
  if (hostWs) {
    try {
      hostWs.close();
    } catch {
      /* ignore */
    }
  }

  setStatus(`Connecting to signaling…`);
  hostWs = new WebSocket(signalUrl());

  hostWs.onopen = () => {
    hostWs!.send(JSON.stringify({ type: "register", id: myId }));
  };

  hostWs.onmessage = async (ev) => {
    const msg = JSON.parse(String(ev.data));
    switch (msg.type) {
      case "registered":
        setStatus("Online — share your ID, or connect to a remote ID.");
        break;

      case "connection_request":
        if (busy() && !pendingRequestId) {
          hostWs?.send(
            JSON.stringify({ type: "reject", requestId: msg.requestId }),
          );
          setStatus("Busy — rejected an incoming request.");
          break;
        }
        pendingRequestId = msg.requestId;
        incomingEl.classList.remove("hidden");
        setStatus("Incoming connection — Accept or Reject.");
        break;

      case "accepted":
        incomingEl.classList.add("hidden");
        sessionEl.classList.remove("hidden");
        setStatus("Accepted — pick a screen to share…");
        try {
          await startHosting(msg.iceServers ?? [], msg.iceTransportPolicy);
          hosting = true;
          setStatus("Screen shared — being controlled.");
          sessionHintEl.textContent =
            "Top overlay stays visible. Disconnect anytime.";
          await showSessionOverlay();
        } catch (err) {
          console.error(err);
          setStatus("Screen share cancelled. Still online.");
          await endHosting({ notify: true });
        }
        break;

      case "rejected":
      case "request_expired":
      case "request_cancelled":
        pendingRequestId = null;
        incomingEl.classList.add("hidden");
        setStatus("Online — waiting for the next request.");
        break;

      case "offer":
      case "answer":
      case "ice":
        await hostPeer?.handleSignal(msg);
        break;

      case "session_ended":
        await endHosting({ notify: false });
        setStatus(
          `Session ended (${msg.reason ?? "unknown"}). Still online.`,
        );
        break;

      case "error":
        setStatus(`Error: ${msg.message}`);
        break;

      default:
        break;
    }
  };

  hostWs.onclose = () => {
    setStatus("Disconnected from signaling. Click Reconnect.");
    void endHosting({ notify: false });
    incomingEl.classList.add("hidden");
  };

  hostWs.onerror = () => {
    setStatus("Signaling error — is the server running?");
  };
}

async function startHosting(
  iceServers: RTCIceServer[],
  iceTransportPolicy?: RTCIceTransportPolicy,
) {
  hostPeer?.close();
  hostPeer = createHostPeer(iceServers, iceTransportPolicy);
  hostPeer.setOnSignal((payload) => {
    hostWs?.send(JSON.stringify(payload));
  });
  hostPeer.setOnInput((raw) => {
    void handleIncomingInput(raw);
  });
  hostPeer.setOnChannelOpen(() => {
    void sendScreenInfo();
  });

  try {
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(960, 720));
    await win.center();
    await win.setFocus();
  } catch {
    /* ignore */
  }

  await hostPeer.startScreenShareAndOffer();
}

async function sendScreenInfo() {
  try {
    const info = await invoke<{ width: number; height: number }>(
      "get_screen_info",
    );
    hostPeer?.send({
      type: "screen_info",
      width: info.width,
      height: info.height,
    });
  } catch {
    hostPeer?.send({
      type: "screen_info",
      width: window.screen.width,
      height: window.screen.height,
    });
  }
}

async function handleIncomingInput(raw: string) {
  if (!hosting) return;
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  if (!event || typeof event.type !== "string" || event.type === "screen_info") {
    return;
  }
  try {
    await invoke("inject_remote_event", { event });
  } catch (err) {
    console.warn("inject failed", err);
  }
}

async function endHosting(opts: { notify: boolean }) {
  const was = hosting || hostPeer !== null;
  hosting = false;
  pendingRequestId = null;
  hostPeer?.close();
  hostPeer = null;
  sessionEl.classList.add("hidden");
  incomingEl.classList.add("hidden");
  await hideSessionOverlay();
  if (opts.notify && was && hostWs?.readyState === WebSocket.OPEN) {
    try {
      hostWs.send(JSON.stringify({ type: "disconnect" }));
    } catch {
      /* ignore */
    }
  }
}

// ——— Remote Desk: connect out ———

function connectToRemote(rawId: string) {
  const id = digitsOnly(rawId);
  if (!/^\d{9}$/.test(id)) {
    setStatus("Enter a valid 9-digit remote ID.");
    return;
  }
  if (id === myId) {
    setStatus("That is your own ID.");
    return;
  }
  if (busy()) {
    setStatus("Already in a session — disconnect first.");
    return;
  }

  void endControlling({ notify: false });
  if (controlWs) {
    try {
      controlWs.close();
    } catch {
      /* ignore */
    }
  }

  controlling = true;
  connectBtn.disabled = true;
  showViewer();
  setViewerStatus(`Connecting to ${formatId(id)}…`);
  setStatus(`Connecting to ${formatId(id)}…`);

  controlWs = new WebSocket(signalUrl());
  controlSignalChain = Promise.resolve();
  earlyControlSignals.length = 0;

  controlWs.onopen = () => {
    controlWs!.send(JSON.stringify({ type: "connect", id }));
  };

  controlWs.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    controlSignalChain = controlSignalChain.then(async () => {
      switch (msg.type) {
        case "waiting":
          setViewerStatus("Waiting for remote to Accept…");
          setStatus("Waiting for remote Accept…");
          break;

        case "accepted":
          setViewerStatus("Accepted — waiting for screen…");
          startViewer(msg.iceServers ?? [], msg.iceTransportPolicy);
          break;

        case "rejected":
          setViewerStatus("Remote rejected.");
          setStatus("Remote rejected the connection.");
          await endControlling({ notify: false });
          break;

        case "timeout":
          setViewerStatus("Remote did not accept in time.");
          setStatus("Remote did not accept in time.");
          await endControlling({ notify: false });
          break;

        case "offer":
        case "answer":
        case "ice":
          if (viewerPeer) {
            await viewerPeer.handleSignal(msg);
          } else {
            earlyControlSignals.push(msg);
          }
          if (msg.type === "offer") setViewerStatus("Receiving screen…");
          break;

        case "session_ended":
          setViewerStatus(`Ended (${msg.reason ?? "unknown"})`);
          setStatus(`Remote session ended (${msg.reason ?? "unknown"}).`);
          await endControlling({ notify: false });
          break;

        case "error":
          setViewerStatus(msg.message ?? "Error");
          setStatus(`Error: ${msg.message}`);
          await endControlling({ notify: false });
          break;

        default:
          break;
      }
    });
  };

  controlWs.onerror = () => {
    setStatus("Could not reach signaling server.");
    void endControlling({ notify: false });
  };

  controlWs.onclose = () => {
    if (controlling) {
      void endControlling({ notify: false });
    }
  };
}

function startViewer(
  iceServers: RTCIceServer[],
  iceTransportPolicy?: RTCIceTransportPolicy,
) {
  viewerPeer?.close();
  viewerPeer = createViewerPeer(
    iceServers,
    remoteVideo,
    iceTransportPolicy,
  );
  viewerPeer.setOnSignal((payload) => {
    controlWs?.send(JSON.stringify(payload));
  });
  viewerPeer.setOnMessage((raw) => {
    try {
      const data = JSON.parse(raw);
      if (data.type === "screen_info") {
        setViewerStatus(`Live · ${data.width}×${data.height}`);
      }
    } catch {
      /* ignore */
    }
  });
  viewerPeer.setOnChannelOpen(() => {
    bindRemoteInput();
    setViewerStatus("Live — click to control");
    setStatus("Controlling remote desk.");
  });

  const queued = earlyControlSignals.splice(0);
  void (async () => {
    for (const msg of queued) {
      await viewerPeer?.handleSignal(msg);
    }
  })();
}

function showViewer() {
  homeEl.classList.add("hidden");
  viewerEl.classList.remove("hidden");
  void getCurrentWindow()
    .setSize(new LogicalSize(1100, 720))
    .catch(() => undefined);
}

function hideViewer() {
  viewerEl.classList.add("hidden");
  homeEl.classList.remove("hidden");
  connectBtn.disabled = false;
}

function bindRemoteInput() {
  if (inputBound) return;
  inputBound = true;
  remoteVideo.tabIndex = 0;

  const send = (obj: unknown) => viewerPeer?.send(obj);

  const onMove = (ev: PointerEvent) => {
    const now = performance.now();
    if (now - lastMoveSent < 16) return;
    lastMoveSent = now;
    const { x, y } = videoNormCoords(remoteVideo, ev.clientX, ev.clientY);
    send({ type: "mousemove", x, y });
  };
  const onDown = (ev: PointerEvent) => {
    remoteVideo.setPointerCapture?.(ev.pointerId);
    remoteVideo.focus();
    const { x, y } = videoNormCoords(remoteVideo, ev.clientX, ev.clientY);
    send({ type: "mousedown", button: ev.button, x, y });
  };
  const onUp = (ev: PointerEvent) => {
    const { x, y } = videoNormCoords(remoteVideo, ev.clientX, ev.clientY);
    send({ type: "mouseup", button: ev.button, x, y });
  };
  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const { x, y } = videoNormCoords(remoteVideo, ev.clientX, ev.clientY);
    send({
      type: "wheel",
      deltaX: ev.deltaX,
      deltaY: ev.deltaY,
      x,
      y,
    });
  };
  const onKeyDown = (ev: KeyboardEvent) => {
    if (!controlling) return;
    if (ev.key === "F5" || (ev.ctrlKey && ev.key === "r")) return;
    ev.preventDefault();
    send({ type: "keydown", key: ev.key, code: ev.code });
  };
  const onKeyUp = (ev: KeyboardEvent) => {
    if (!controlling) return;
    if (ev.key === "F5" || (ev.ctrlKey && ev.key === "r")) return;
    ev.preventDefault();
    send({ type: "keyup", key: ev.key, code: ev.code });
  };
  const onCtx = (ev: Event) => ev.preventDefault();

  remoteVideo.addEventListener("pointermove", onMove);
  remoteVideo.addEventListener("pointerdown", onDown);
  remoteVideo.addEventListener("pointerup", onUp);
  remoteVideo.addEventListener("wheel", onWheel, { passive: false });
  remoteVideo.addEventListener("contextmenu", onCtx);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  (
    remoteVideo as HTMLVideoElement & { __cleanup?: () => void }
  ).__cleanup = () => {
    remoteVideo.removeEventListener("pointermove", onMove);
    remoteVideo.removeEventListener("pointerdown", onDown);
    remoteVideo.removeEventListener("pointerup", onUp);
    remoteVideo.removeEventListener("wheel", onWheel);
    remoteVideo.removeEventListener("contextmenu", onCtx);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}

function unbindRemoteInput() {
  if (!inputBound) return;
  inputBound = false;
  (
    remoteVideo as HTMLVideoElement & { __cleanup?: () => void }
  ).__cleanup?.();
}

async function endControlling(opts: { notify: boolean }) {
  const was = controlling || viewerPeer !== null || controlWs !== null;
  controlling = false;
  unbindRemoteInput();
  viewerPeer?.close();
  viewerPeer = null;
  hideViewer();

  if (opts.notify && was && controlWs?.readyState === WebSocket.OPEN) {
    try {
      controlWs.send(JSON.stringify({ type: "disconnect" }));
    } catch {
      /* ignore */
    }
  }
  if (controlWs) {
    try {
      controlWs.close();
    } catch {
      /* ignore */
    }
    controlWs = null;
  }

  if (hostWs?.readyState === WebSocket.OPEN) {
    setStatus("Online — share your ID, or connect to a remote ID.");
  }
}

// ——— UI events ———

remoteIdInput.addEventListener("input", () => {
  formatRemoteInput(remoteIdInput.value);
});

remoteForm.addEventListener("submit", (ev) => {
  ev.preventDefault();
  connectToRemote(remoteIdInput.value);
});

acceptBtn.addEventListener("click", () => {
  if (!pendingRequestId || !hostWs) return;
  hostWs.send(
    JSON.stringify({ type: "accept", requestId: pendingRequestId }),
  );
  pendingRequestId = null;
});

rejectBtn.addEventListener("click", () => {
  if (!pendingRequestId || !hostWs) return;
  hostWs.send(
    JSON.stringify({ type: "reject", requestId: pendingRequestId }),
  );
  pendingRequestId = null;
  incomingEl.classList.add("hidden");
  setStatus("Rejected. Still online.");
});

disconnectHostBtn.addEventListener("click", () => {
  void endHosting({ notify: true }).then(() => {
    setStatus("Disconnected session. Still online.");
  });
});

disconnectRemoteBtn.addEventListener("click", () => {
  void endControlling({ notify: true });
});

void listen("deskly-host-disconnect", () => {
  void endHosting({ notify: true }).then(() => {
    setStatus("Disconnected session. Still online.");
  });
});

reconnectBtn.addEventListener("click", () => connectHostSignaling());

connectHostSignaling();
