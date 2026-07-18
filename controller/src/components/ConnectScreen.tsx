"use client";

import { FormEvent, useState } from "react";
import { digitsOnly } from "@/lib/config";
import type { SessionStatus } from "@/hooks/useRemoteSession";
import styles from "./ConnectScreen.module.css";

type Props = {
  signalingUrl: string;
  onSignalingUrlChange: (url: string) => void;
  forceRelay: boolean;
  onForceRelayChange: (value: boolean) => void;
  status: SessionStatus;
  message: string;
  busy: boolean;
  onConnect: (hostId: string) => void;
};

export function ConnectScreen({
  signalingUrl,
  onSignalingUrlChange,
  forceRelay,
  onForceRelayChange,
  status,
  message,
  busy,
  onConnect,
}: Props) {
  const [hostId, setHostId] = useState("");

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    onConnect(hostId);
  }

  function onIdChange(value: string) {
    const d = digitsOnly(value).slice(0, 9);
    const pretty = d.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
    setHostId(pretty);
  }

  return (
    <main className={styles.shell}>
      <div className={styles.glow} aria-hidden />
      <section className={styles.panel}>
        <p className={styles.brand}>Deskly</p>
        <h1 className={styles.title}>Remote control</h1>
        <p className={styles.lead}>
          Enter the host ID. They must Accept on their PC before you can see
          or control the screen.
        </p>

        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.label}>
            Host ID
            <input
              className={styles.input}
              inputMode="numeric"
              autoComplete="off"
              placeholder="482 193 017"
              value={hostId}
              onChange={(e) => onIdChange(e.target.value)}
              maxLength={11}
              required
              disabled={busy}
            />
          </label>

          <button className={styles.primary} type="submit" disabled={busy}>
            {status === "waiting"
              ? "Waiting for host…"
              : status === "connecting"
                ? "Connecting…"
                : "Connect"}
          </button>
        </form>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={forceRelay}
            disabled={busy}
            onChange={(e) => onForceRelayChange(e.target.checked)}
          />
          Force TURN relay (NAT test)
        </label>

        <p className={styles.status} data-status={status}>
          {message}
        </p>

        <label className={styles.signal}>
          Signaling server
          <input
            value={signalingUrl}
            onChange={(e) => onSignalingUrlChange(e.target.value)}
            spellCheck={false}
            disabled={busy}
          />
        </label>
      </section>
    </main>
  );
}
