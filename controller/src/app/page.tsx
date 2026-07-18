"use client";

import { useState } from "react";
import { ConnectScreen } from "@/components/ConnectScreen";
import { SessionScreen } from "@/components/SessionScreen";
import { getDefaultSignalingHttpUrl } from "@/lib/config";
import { useRemoteSession } from "@/hooks/useRemoteSession";

export default function Home() {
  const [signalingUrl, setSignalingUrl] = useState(getDefaultSignalingHttpUrl);
  const [forceRelay, setForceRelay] = useState(false);
  const session = useRemoteSession(signalingUrl);

  const busy =
    session.status === "connecting" || session.status === "waiting";

  if (session.active) {
    return (
      <SessionScreen
        message={session.message}
        screenInfo={session.screenInfo}
        videoRef={session.videoRef}
        onDisconnect={session.disconnect}
      />
    );
  }

  return (
    <ConnectScreen
      signalingUrl={signalingUrl}
      onSignalingUrlChange={setSignalingUrl}
      forceRelay={forceRelay}
      onForceRelayChange={setForceRelay}
      status={session.status}
      message={session.message}
      busy={busy}
      onConnect={(hostId) => session.connect(hostId, { forceRelay })}
    />
  );
}
