/** Shared WebRTC helpers for Deskly signaling test pages. */

export function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

/**
 * Controller peer: receives video + input DataChannel from host.
 */
export function createViewerPeer({ iceServers, videoEl, iceTransportPolicy }) {
  const pc = new RTCPeerConnection({
    iceServers,
    ...(iceTransportPolicy ? { iceTransportPolicy } : {}),
  });
  /** @type {RTCDataChannel | null} */
  let channel = null;
  /** @type {(msg: object) => void} */
  let onSignal = () => {};
  /** @type {(data: string) => void} */
  let onMessage = () => {};
  /** @type {() => void} */
  let onChannelOpen = () => {};

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      onSignal({ type: "ice", candidate: ev.candidate.toJSON() });
    }
  };

  pc.ontrack = (ev) => {
    if (videoEl) {
      videoEl.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
    }
  };

  pc.ondatachannel = (ev) => {
    channel = ev.channel;
    channel.onopen = () => onChannelOpen();
    channel.onmessage = (e) => onMessage(String(e.data));
  };

  async function handleSignal(msg) {
    if (msg.type === "offer") {
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      onSignal({ type: "answer", sdp: pc.localDescription });
    } else if (msg.type === "ice" && msg.candidate) {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (err) {
        console.warn("ICE add failed", err);
      }
    }
  }

  function send(data) {
    if (channel?.readyState === "open") {
      channel.send(typeof data === "string" ? data : JSON.stringify(data));
    }
  }

  function close() {
    try {
      channel?.close();
    } catch {
      /* ignore */
    }
    channel = null;
    if (videoEl) videoEl.srcObject = null;
    pc.close();
  }

  return {
    pc,
    setOnSignal(fn) {
      onSignal = fn;
    },
    setOnMessage(fn) {
      onMessage = fn;
    },
    setOnChannelOpen(fn) {
      onChannelOpen = fn;
    },
    handleSignal,
    send,
    close,
  };
}

/**
 * Browser host peer (Phase 2 test without Tauri): capture + offer video.
 * Note: browser host cannot inject OS input — use Tauri host for Phase 3.
 */
export function createHostVideoPeer({ iceServers, iceTransportPolicy }) {
  const pc = new RTCPeerConnection({
    iceServers,
    ...(iceTransportPolicy ? { iceTransportPolicy } : {}),
  });
  /** @type {MediaStream | null} */
  let localStream = null;
  /** @type {RTCDataChannel | null} */
  let channel = null;
  /** @type {(msg: object) => void} */
  let onSignal = () => {};

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      onSignal({ type: "ice", candidate: ev.candidate.toJSON() });
    }
  };

  async function handleSignal(msg) {
    if (msg.type === "answer") {
      await pc.setRemoteDescription(msg.sdp);
    } else if (msg.type === "ice" && msg.candidate) {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (err) {
        console.warn("ICE add failed", err);
      }
    }
  }

  async function startScreenShareAndOffer() {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
    channel = pc.createDataChannel("deskly-input", { ordered: true });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    onSignal({ type: "offer", sdp: pc.localDescription });
  }

  function close() {
    try {
      channel?.close();
    } catch {
      /* ignore */
    }
    localStream?.getTracks().forEach((t) => t.stop());
    localStream = null;
    pc.close();
  }

  return {
    pc,
    setOnSignal(fn) {
      onSignal = fn;
    },
    handleSignal,
    startScreenShareAndOffer,
    close,
  };
}

export function randomHostId() {
  let id = "";
  for (let i = 0; i < 9; i++) {
    id += Math.floor(Math.random() * 10);
  }
  if (id[0] === "0") id = "1" + id.slice(1);
  return id;
}

export function formatId(id) {
  const d = String(id).replace(/\D/g, "");
  return d.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

/**
 * Map pointer position inside a video element (object-fit: contain) to 0–1.
 */
export function videoNormCoords(videoEl, clientX, clientY) {
  const rect = videoEl.getBoundingClientRect();
  const vw = videoEl.videoWidth || 1;
  const vh = videoEl.videoHeight || 1;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const contentW = vw * scale;
  const contentH = vh * scale;
  const offsetX = rect.left + (rect.width - contentW) / 2;
  const offsetY = rect.top + (rect.height - contentH) / 2;
  const x = (clientX - offsetX) / contentW;
  const y = (clientY - offsetY) / contentH;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}
