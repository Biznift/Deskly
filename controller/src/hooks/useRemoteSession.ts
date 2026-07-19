"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { digitsOnly, formatHostId, httpToWs } from "@/lib/config";
import { videoNormCoords } from "@/lib/coords";
import {
  createViewerPeer,
  type ScreenInfo,
  type ViewerPeer,
} from "@/lib/webrtc";

export type SessionStatus =
  | "idle"
  | "connecting"
  | "waiting"
  | "negotiating"
  | "live"
  | "rejected"
  | "timeout"
  | "ended"
  | "error";

type PendingSession = {
  iceServers: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
  ws: WebSocket;
  started?: boolean;
};

type SignalMsg = {
  type: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export function useRemoteSession(signalingHttpUrl: string) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [message, setMessage] = useState("Enter a host ID to connect.");
  const [active, setActive] = useState(false);
  const [screenInfo, setScreenInfo] = useState<ScreenInfo | null>(null);
  const [setupNonce, setSetupNonce] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<ViewerPeer | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const inputBoundRef = useRef(false);
  const lastMoveRef = useRef(0);
  const earlySignalsRef = useRef<SignalMsg[]>([]);
  const pendingRef = useRef<PendingSession | null>(null);
  const peerGenRef = useRef(0);
  const signalChainRef = useRef<Promise<void>>(Promise.resolve());

  const unbindInput = useCallback(() => {
    if (!inputBoundRef.current) return;
    inputBoundRef.current = false;
    const video = videoRef.current as
      | (HTMLVideoElement & { __desklyCleanup?: () => void })
      | null;
    video?.__desklyCleanup?.();
  }, []);

  const cleanupPeer = useCallback(() => {
    unbindInput();
    peerRef.current?.close();
    peerRef.current = null;
    earlySignalsRef.current = [];
    pendingRef.current = null;
    setScreenInfo(null);
  }, [unbindInput]);

  const disconnect = useCallback(() => {
    cleanupPeer();
    setActive(false);
    const ws = wsRef.current;
    if (ws) {
      try {
        ws.send(JSON.stringify({ type: "disconnect" }));
      } catch {
        /* ignore */
      }
      ws.close();
      wsRef.current = null;
    }
    setStatus("idle");
    setMessage("Disconnected.");
  }, [cleanupPeer]);

  const bindInput = useCallback(
    (video: HTMLVideoElement, peer: ViewerPeer) => {
      if (inputBoundRef.current) return;
      inputBoundRef.current = true;
      video.tabIndex = 0;
      video.style.cursor = "none";

      const send = (obj: unknown) => peer.send(obj);

      const onPointerMove = (ev: PointerEvent) => {
        const now = performance.now();
        if (now - lastMoveRef.current < 16) return;
        lastMoveRef.current = now;
        const { x, y } = videoNormCoords(video, ev.clientX, ev.clientY);
        send({ type: "mousemove", x, y });
      };
      const onPointerDown = (ev: PointerEvent) => {
        video.setPointerCapture?.(ev.pointerId);
        video.focus();
        const { x, y } = videoNormCoords(video, ev.clientX, ev.clientY);
        send({ type: "mousedown", button: ev.button, x, y });
      };
      const onPointerUp = (ev: PointerEvent) => {
        const { x, y } = videoNormCoords(video, ev.clientX, ev.clientY);
        send({ type: "mouseup", button: ev.button, x, y });
      };
      const onWheel = (ev: WheelEvent) => {
        ev.preventDefault();
        const { x, y } = videoNormCoords(video, ev.clientX, ev.clientY);
        send({
          type: "wheel",
          deltaX: ev.deltaX,
          deltaY: ev.deltaY,
          x,
          y,
        });
      };
      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === "F5" || (ev.ctrlKey && ev.key === "r")) return;
        ev.preventDefault();
        send({ type: "keydown", key: ev.key, code: ev.code });
      };
      const onKeyUp = (ev: KeyboardEvent) => {
        if (ev.key === "F5" || (ev.ctrlKey && ev.key === "r")) return;
        ev.preventDefault();
        send({ type: "keyup", key: ev.key, code: ev.code });
      };
      const onContextMenu = (ev: Event) => ev.preventDefault();

      video.addEventListener("pointermove", onPointerMove);
      video.addEventListener("pointerdown", onPointerDown);
      video.addEventListener("pointerup", onPointerUp);
      video.addEventListener("wheel", onWheel, { passive: false });
      video.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);

      (
        video as HTMLVideoElement & { __desklyCleanup?: () => void }
      ).__desklyCleanup = () => {
        video.removeEventListener("pointermove", onPointerMove);
        video.removeEventListener("pointerdown", onPointerDown);
        video.removeEventListener("pointerup", onPointerUp);
        video.removeEventListener("wheel", onWheel);
        video.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        video.style.cursor = "";
      };
    },
    [],
  );

  useLayoutEffect(() => {
    if (!active || setupNonce === 0) return;
    const session = pendingRef.current;
    const video = videoRef.current;
    if (!session || !video || session.started) return;
    session.started = true;

    const { iceServers, iceTransportPolicy, ws } = session;
    const gen = ++peerGenRef.current;
    const peer = createViewerPeer({
      iceServers,
      videoEl: video,
      iceTransportPolicy,
    });

    peer.setOnSignal((payload) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    });
    peer.setOnMessage((raw) => {
      if (peerGenRef.current !== gen) return;
      try {
        const data = JSON.parse(raw);
        if (data.type === "screen_info") {
          setScreenInfo({ width: data.width, height: data.height });
          setMessage(`Live control · ${data.width}×${data.height}`);
        }
      } catch {
        /* ignore */
      }
    });
    peer.setOnChannelOpen(() => {
      if (peerGenRef.current !== gen) return;
      bindInput(video, peer);
      setStatus("live");
      setMessage("Live — click the screen to control");
    });
    peer.pc.onconnectionstatechange = () => {
      if (peerGenRef.current !== gen) return;
      if (peer.pc.connectionState === "connected") {
        setStatus("live");
      }
    };

    peerRef.current = peer;

    const queued = earlySignalsRef.current.splice(0);
    void (async () => {
      for (const msg of queued) {
        if (peerGenRef.current !== gen) return;
        await peer.handleSignal(msg);
      }
    })();

    return () => {
      peer.close();
      if (peerRef.current === peer) peerRef.current = null;
      session.started = false;
    };
  }, [active, setupNonce, bindInput]);

  const connect = useCallback(
    (rawId: string, opts?: { forceRelay?: boolean }) => {
      const id = digitsOnly(rawId);
      if (!/^\d{9}$/.test(id)) {
        setStatus("error");
        setMessage("Enter a valid 9-digit host ID.");
        return;
      }

      cleanupPeer();
      wsRef.current?.close();
      setActive(false);
      setStatus("connecting");
      setMessage(`Connecting to ${formatHostId(id)}…`);

      const wsUrl = httpToWs(signalingHttpUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      signalChainRef.current = Promise.resolve();

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "connect",
            id,
            forceRelay: Boolean(opts?.forceRelay),
          }),
        );
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as SignalMsg & {
          message?: string;
          reason?: string;
          iceServers?: RTCIceServer[];
          iceTransportPolicy?: RTCIceTransportPolicy;
        };

        signalChainRef.current = signalChainRef.current.then(async () => {
          switch (msg.type) {
            case "waiting":
              setStatus("waiting");
              setMessage("Waiting for host to accept…");
              break;

            case "accepted":
              setStatus("negotiating");
              setMessage(
                msg.iceTransportPolicy === "relay"
                  ? "Accepted — negotiating via TURN relay…"
                  : "Accepted — waiting for screen…",
              );
              pendingRef.current = {
                iceServers: msg.iceServers ?? [],
                iceTransportPolicy: msg.iceTransportPolicy,
                ws,
              };
              setActive(true);
              setSetupNonce((n) => n + 1);
              break;

            case "rejected":
              setStatus("rejected");
              setMessage("Host rejected the connection.");
              setActive(false);
              cleanupPeer();
              ws.close();
              break;

            case "timeout":
              setStatus("timeout");
              setMessage("Host did not accept in time.");
              setActive(false);
              cleanupPeer();
              ws.close();
              break;

            case "offer":
            case "answer":
            case "ice":
              if (peerRef.current) {
                await peerRef.current.handleSignal(msg);
              } else {
                earlySignalsRef.current.push(msg);
              }
              if (msg.type === "offer") {
                setMessage("Receiving screen…");
              }
              break;

            case "session_ended":
              setStatus("ended");
              setMessage(`Session ended (${msg.reason ?? "unknown"}).`);
              setActive(false);
              cleanupPeer();
              ws.close();
              break;

            case "error":
              setStatus("error");
              setMessage(msg.message ?? "Connection error");
              setActive(false);
              cleanupPeer();
              ws.close();
              break;

            default:
              break;
          }
        });
      };

      ws.onerror = () => {
        setStatus("error");
        setMessage("Could not reach signaling server.");
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
      };
    },
    [cleanupPeer, signalingHttpUrl],
  );

  useEffect(() => {
    return () => {
      cleanupPeer();
      wsRef.current?.close();
    };
  }, [cleanupPeer]);

  return {
    status,
    message,
    active,
    screenInfo,
    videoRef,
    connect,
    disconnect,
  };
}
