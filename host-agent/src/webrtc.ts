/** WebRTC helpers for Deskly host (offers video + input DataChannel). */

export type SignalOut =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit };

export type IceServer = RTCIceServer;

export type InputHandler = (data: string) => void;

type InSignal = {
  type: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export function randomHostId(): string {
  let id = "";
  for (let i = 0; i < 9; i++) {
    id += Math.floor(Math.random() * 10);
  }
  if (id[0] === "0") id = "1" + id.slice(1);
  return id;
}

export function formatId(id: string): string {
  const d = String(id).replace(/\D/g, "");
  return d.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

export function createHostPeer(
  iceServers: IceServer[],
  iceTransportPolicy?: RTCIceTransportPolicy,
) {
  const pc = new RTCPeerConnection({
    iceServers,
    ...(iceTransportPolicy ? { iceTransportPolicy } : {}),
  });
  let localStream: MediaStream | null = null;
  let channel: RTCDataChannel | null = null;
  let onSignal: (msg: SignalOut) => void = () => {};
  let onInput: InputHandler = () => {};
  let onChannelOpen: () => void = () => {};
  const pendingIce: RTCIceCandidateInit[] = [];
  let remoteSet = false;
  let chain: Promise<void> = Promise.resolve();

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      onSignal({ type: "ice", candidate: ev.candidate.toJSON() });
    }
  };

  function wireChannel(ch: RTCDataChannel) {
    ch.binaryType = "arraybuffer";
    ch.onopen = () => onChannelOpen();
    ch.onmessage = (ev) => onInput(String(ev.data));
  }

  async function flushIce() {
    while (pendingIce.length) {
      const c = pendingIce.shift()!;
      try {
        await pc.addIceCandidate(c);
      } catch (err) {
        console.warn("ICE add failed", err);
      }
    }
  }

  async function handleSignalInner(msg: InSignal) {
    if (msg.type === "answer" && msg.sdp) {
      await pc.setRemoteDescription(msg.sdp);
      remoteSet = true;
      await flushIce();
    } else if (msg.type === "ice" && msg.candidate) {
      if (!remoteSet) {
        pendingIce.push(msg.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (err) {
        console.warn("ICE add failed", err);
      }
    }
  }

  function handleSignal(msg: InSignal) {
    chain = chain.then(() => handleSignalInner(msg)).catch((err) => {
      console.warn("signal handling failed", err);
    });
    return chain;
  }

  /**
   * Capture screen, open input DataChannel, send offer.
   * Security: WebRTC uses DTLS-SRTP by default — do not disable encryption.
   */
  async function startScreenShareAndOffer() {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    });

    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
      track.addEventListener("ended", () => {
        // User stopped sharing from OS UI — leave peer; main handles disconnect.
      });
    }

    channel = pc.createDataChannel("deskly-input", { ordered: true });
    wireChannel(channel);

    const offer = await pc.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
    });
    await pc.setLocalDescription(offer);
    onSignal({ type: "offer", sdp: pc.localDescription! });
  }

  function send(data: unknown) {
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
    localStream?.getTracks().forEach((t) => t.stop());
    localStream = null;
    pc.close();
  }

  return {
    pc,
    setOnSignal(fn: (msg: SignalOut) => void) {
      onSignal = fn;
    },
    setOnInput(fn: InputHandler) {
      onInput = fn;
    },
    setOnChannelOpen(fn: () => void) {
      onChannelOpen = fn;
    },
    handleSignal,
    startScreenShareAndOffer,
    send,
    close,
  };
}

/** Controller/viewer peer: receive remote screen + send input. */
export function createViewerPeer(
  iceServers: IceServer[],
  videoEl: HTMLVideoElement,
  iceTransportPolicy?: RTCIceTransportPolicy,
) {
  const pc = new RTCPeerConnection({
    iceServers,
    ...(iceTransportPolicy ? { iceTransportPolicy } : {}),
  });
  let channel: RTCDataChannel | null = null;
  let onSignal: (msg: SignalOut) => void = () => {};
  let onMessage: (data: string) => void = () => {};
  let onChannelOpen: () => void = () => {};
  const pendingIce: RTCIceCandidateInit[] = [];
  let remoteSet = false;
  let chain: Promise<void> = Promise.resolve();

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      onSignal({ type: "ice", candidate: ev.candidate.toJSON() });
    }
  };

  pc.ontrack = (ev) => {
    videoEl.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
  };

  pc.ondatachannel = (ev) => {
    channel = ev.channel;
    channel.onopen = () => onChannelOpen();
    channel.onmessage = (e) => onMessage(String(e.data));
  };

  async function flushIce() {
    while (pendingIce.length) {
      const c = pendingIce.shift()!;
      try {
        await pc.addIceCandidate(c);
      } catch (err) {
        console.warn("ICE add failed", err);
      }
    }
  }

  async function handleSignalInner(msg: InSignal) {
    if (msg.type === "offer" && msg.sdp) {
      await pc.setRemoteDescription(msg.sdp);
      remoteSet = true;
      await flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      onSignal({ type: "answer", sdp: pc.localDescription! });
    } else if (msg.type === "ice" && msg.candidate) {
      if (!remoteSet) {
        pendingIce.push(msg.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (err) {
        console.warn("ICE add failed", err);
      }
    }
  }

  function handleSignal(msg: InSignal) {
    chain = chain.then(() => handleSignalInner(msg)).catch((err) => {
      console.warn("signal handling failed", err);
    });
    return chain;
  }

  function send(data: unknown) {
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
    videoEl.srcObject = null;
    pc.close();
  }

  return {
    pc,
    setOnSignal(fn: (msg: SignalOut) => void) {
      onSignal = fn;
    },
    setOnMessage(fn: (data: string) => void) {
      onMessage = fn;
    },
    setOnChannelOpen(fn: () => void) {
      onChannelOpen = fn;
    },
    handleSignal,
    send,
    close,
  };
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Map pointer inside a video (object-fit: contain) to normalized 0–1. */
export function videoNormCoords(
  videoEl: HTMLVideoElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
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
