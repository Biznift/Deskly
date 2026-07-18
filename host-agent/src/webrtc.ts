/** WebRTC helpers for Deskly host (offers video + input DataChannel). */

export type SignalOut =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit };

export type IceServer = RTCIceServer;

export type InputHandler = (data: string) => void;

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

  async function handleSignal(msg: {
    type: string;
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  }) {
    if (msg.type === "answer" && msg.sdp) {
      await pc.setRemoteDescription(msg.sdp);
    } else if (msg.type === "ice" && msg.candidate) {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (err) {
        console.warn("ICE add failed", err);
      }
    }
  }

/**
   * Capture screen, open input DataChannel, send offer.
   * Phase 2 uses getDisplayMedia (WebView). Native DXGI replaces this later.
   *
   * Security: browser WebRTC uses DTLS-SRTP for media and DTLS for DataChannel.
   * Do not pass any option that disables encryption.
   */
  async function startScreenShareAndOffer() {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 30 },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });

    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
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
