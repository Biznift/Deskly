export type SignalOut =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit };

export type ScreenInfo = { width: number; height: number };

export function createViewerPeer(opts: {
  iceServers: RTCIceServer[];
  videoEl: HTMLVideoElement;
  iceTransportPolicy?: RTCIceTransportPolicy;
}) {
  const { iceServers, videoEl, iceTransportPolicy } = opts;
  const pc = new RTCPeerConnection({
    iceServers,
    ...(iceTransportPolicy ? { iceTransportPolicy } : {}),
  });
  let channel: RTCDataChannel | null = null;
  let onSignal: (msg: SignalOut) => void = () => {};
  let onMessage: (data: string) => void = () => {};
  let onChannelOpen: () => void = () => {};

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

  async function handleSignal(msg: {
    type: string;
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  }) {
    if (msg.type === "offer" && msg.sdp) {
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      onSignal({ type: "answer", sdp: pc.localDescription! });
    } else if (msg.type === "ice" && msg.candidate) {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (err) {
        console.warn("ICE add failed", err);
      }
    }
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

export type ViewerPeer = ReturnType<typeof createViewerPeer>;
