/**
 * Sliding-window rate limiter keyed by host ID.
 * Default: max 5 attempts per 60 seconds, then lockout for remaining window.
 */

export function createRateLimiter({
  maxAttempts = 5,
  windowMs = 60_000,
} = {}) {
  /** @type {Map<string, number[]>} */
  const attempts = new Map();

  /**
   * @param {string} hostId
   * @returns {{ allowed: true } | { allowed: false, retryAfterMs: number }}
   */
  function check(hostId) {
    const now = Date.now();
    const timestamps = (attempts.get(hostId) ?? []).filter(
      (t) => now - t < windowMs,
    );
    attempts.set(hostId, timestamps);

    if (timestamps.length >= maxAttempts) {
      const oldest = timestamps[0];
      const retryAfterMs = windowMs - (now - oldest);
      return { allowed: false, retryAfterMs };
    }
    return { allowed: true };
  }

  /** @param {string} hostId */
  function record(hostId) {
    const now = Date.now();
    const timestamps = (attempts.get(hostId) ?? []).filter(
      (t) => now - t < windowMs,
    );
    timestamps.push(now);
    attempts.set(hostId, timestamps);
  }

  return { check, record };
}
