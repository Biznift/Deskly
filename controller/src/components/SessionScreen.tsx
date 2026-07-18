"use client";

import { RefObject } from "react";
import styles from "./SessionScreen.module.css";

type Props = {
  message: string;
  screenInfo: { width: number; height: number } | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  onDisconnect: () => void;
};

export function SessionScreen({
  message,
  screenInfo,
  videoRef,
  onDisconnect,
}: Props) {
  return (
    <div className={styles.stage}>
      <header className={styles.bar}>
        <div className={styles.meta}>
          <span className={styles.brand}>Deskly</span>
          <span className={styles.msg}>{message}</span>
          {screenInfo ? (
            <span className={styles.res}>
              {screenInfo.width}×{screenInfo.height}
            </span>
          ) : null}
        </div>
        <button type="button" className={styles.danger} onClick={onDisconnect}>
          Disconnect
        </button>
      </header>
      <video
        ref={videoRef}
        className={styles.video}
        autoPlay
        playsInline
        muted
      />
    </div>
  );
}
