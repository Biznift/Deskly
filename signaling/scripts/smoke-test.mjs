/**
 * Headless smoke test for Phase 1 signaling + Accept flow.
 * Run while the server is up: node scripts/smoke-test.mjs
 */
import WebSocket from "ws";

const URL = process.env.SIGNAL_URL || "ws://127.0.0.1:8080";
const HOST_ID = "482193017";

function once(ws, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${type}`)),
      timeoutMs,
    );
    function onMessage(raw) {
      const msg = JSON.parse(String(raw));
      if (msg.type === type || (type === "any" && msg.type)) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(msg);
      }
    }
    ws.on("message", onMessage);
  });
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

const host = new WebSocket(URL);
const controller = new WebSocket(URL);

await Promise.all([
  new Promise((r) => host.once("open", r)),
  new Promise((r) => controller.once("open", r)),
]);

send(host, { type: "register", id: HOST_ID });
const registered = await once(host, "registered");
console.log("OK register", registered.id);

send(controller, { type: "connect", id: HOST_ID });
const [waiting, request] = await Promise.all([
  once(controller, "waiting"),
  once(host, "connection_request"),
]);
console.log("OK waiting", waiting.requestId);
console.log("OK connection_request", request.requestId);

send(host, { type: "accept", requestId: request.requestId });
const [ctrlAccepted, hostAccepted] = await Promise.all([
  once(controller, "accepted"),
  once(host, "accepted"),
]);
console.log("OK accepted", {
  ice: ctrlAccepted.iceServers?.length,
  hostIce: hostAccepted.iceServers?.length,
});

// Relay a fake offer
send(controller, {
  type: "offer",
  sdp: { type: "offer", sdp: "v=0\r\n" },
});
const offer = await once(host, "offer");
console.log("OK offer relay", offer.sdp?.type);

send(host, {
  type: "answer",
  sdp: { type: "answer", sdp: "v=0\r\n" },
});
const answer = await once(controller, "answer");
console.log("OK answer relay", answer.sdp?.type);

send(host, { type: "disconnect" });
const ended = await once(controller, "session_ended");
console.log("OK session_ended", ended.reason);

host.close();
controller.close();
console.log("SMOKE PASS");
process.exit(0);
