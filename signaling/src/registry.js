/** In-memory host registry for MVP. */

export function createRegistry() {
  /** @type {Map<string, HostEntry>} */
  const hosts = new Map();

  /**
   * @typedef {object} PendingRequest
   * @property {string} requestId
   * @property {import('ws').WebSocket} controllerWs
   * @property {ReturnType<typeof setTimeout>} timeout
   * @property {boolean} forceRelay
   */

  /**
   * @typedef {object} HostEntry
   * @property {string} id
   * @property {import('ws').WebSocket} ws
   * @property {import('ws').WebSocket | null} controllerWs
   * @property {boolean} sessionActive
   * @property {PendingRequest | null} pending
   */

  /**
   * @param {string} id
   * @param {import('ws').WebSocket} ws
   * @returns {{ ok: true } | { ok: false, error: string }}
   */
  function register(id, ws) {
    const existing = hosts.get(id);
    if (existing && existing.ws !== ws && existing.ws.readyState === 1) {
      return { ok: false, error: "id_in_use" };
    }
    if (existing?.pending) {
      clearTimeout(existing.pending.timeout);
    }
    hosts.set(id, {
      id,
      ws,
      controllerWs: null,
      sessionActive: false,
      pending: null,
    });
    return { ok: true };
  }

  /** @param {string} id */
  function get(id) {
    return hosts.get(id) ?? null;
  }

  /**
   * @param {import('ws').WebSocket} ws
   * @returns {HostEntry | null}
   */
  function findByHostWs(ws) {
    for (const entry of hosts.values()) {
      if (entry.ws === ws) return entry;
    }
    return null;
  }

  /**
   * @param {import('ws').WebSocket} ws
   * @returns {HostEntry | null}
   */
  function findByControllerWs(ws) {
    for (const entry of hosts.values()) {
      if (entry.controllerWs === ws) return entry;
      if (entry.pending?.controllerWs === ws) return entry;
    }
    return null;
  }

  /**
   * @param {string} id
   * @param {import('ws').WebSocket} hostWs
   */
  function unregisterIfMatch(id, hostWs) {
    const entry = hosts.get(id);
    if (entry && entry.ws === hostWs) {
      if (entry.pending) clearTimeout(entry.pending.timeout);
      hosts.delete(id);
    }
  }

  return {
    register,
    get,
    findByHostWs,
    findByControllerWs,
    unregisterIfMatch,
    hosts,
  };
}
