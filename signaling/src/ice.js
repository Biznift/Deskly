import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Build RTCIceServer list: STUN always; TURN when TURN_URLS + TURN_SECRET set.
 * Uses coturn `use-auth-secret` (TURN REST / ephemeral credentials).
 *
 * Env:
 *   TURN_URLS=turn:127.0.0.1:3478,turn:127.0.0.1:3478?transport=tcp
 *   TURN_SECRET=same-as-coturn
 *   TURN_REALM=deskly.local (optional, informational)
 *   TURN_TTL_SECONDS=3600
 *   STUN_URLS=stun:stun.l.google.com:19302 (optional override)
 */

function splitUrls(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string} secret
 * @param {string} username
 */
export function turnCredential(secret, username) {
  return createHmac("sha1", secret).update(username).digest("base64");
}

/**
 * @param {{ forceRelay?: boolean }} [opts]
 * @returns {{ iceServers: RTCIceServer[], iceTransportPolicy?: 'relay' | 'all' }}
 */
export function buildIceConfig(opts = {}) {
  const stunUrls = splitUrls(
    process.env.STUN_URLS || "stun:stun.l.google.com:19302",
  );
  /** @type {import('ws').WebSocket extends never ? never : object[]} */
  const iceServers = [];

  for (const urls of stunUrls) {
    iceServers.push({ urls });
  }

  const turnUrls = splitUrls(process.env.TURN_URLS || "");
  const secret = process.env.TURN_SECRET || "";

  if (turnUrls.length > 0 && secret) {
    const ttl = Number(process.env.TURN_TTL_SECONDS) || 3600;
    const expiry = Math.floor(Date.now() / 1000) + ttl;
    // username = expiry (or expiry:userid). Credential = HMAC-SHA1(secret, username)
    const username = String(expiry);
    const credential = turnCredential(secret, username);
    iceServers.push({
      urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
      username,
      credential,
    });
  }

  const config = { iceServers };
  const hasTurn = iceServers.some(
    (s) =>
      s.username &&
      ((typeof s.urls === "string" && String(s.urls).startsWith("turn:")) ||
        (Array.isArray(s.urls) && s.urls.some((u) => String(u).startsWith("turn:")))),
  );
  // Never force relay without TURN — that guarantees ICE failure.
  if (opts.forceRelay && hasTurn) {
    config.iceTransportPolicy = "relay";
  }
  return config;
}

/**
 * Optional self-check that HMAC matches expected format (for tests).
 */
export function verifyTurnCredential(secret, username, credential) {
  const expected = turnCredential(secret, username);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(credential));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
