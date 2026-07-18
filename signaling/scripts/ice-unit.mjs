import { createHmac } from "node:crypto";
import { buildIceConfig, turnCredential, verifyTurnCredential } from "../src/ice.js";

process.env.STUN_URLS = "stun:stun.l.google.com:19302";
process.env.TURN_URLS = "turn:127.0.0.1:3478,turn:127.0.0.1:3478?transport=tcp";
process.env.TURN_SECRET = "test-secret";
process.env.TURN_TTL_SECONDS = "600";

const ice = buildIceConfig({ forceRelay: true });
if (!ice.iceTransportPolicy || ice.iceTransportPolicy !== "relay") {
  throw new Error("expected iceTransportPolicy relay");
}

const turn = ice.iceServers.find((s) => s.username);
if (!turn?.username || !turn.credential) {
  throw new Error("expected TURN credentials");
}

const expected = createHmac("sha1", "test-secret")
  .update(turn.username)
  .digest("base64");
if (turn.credential !== expected) {
  throw new Error("credential mismatch");
}
if (!verifyTurnCredential("test-secret", turn.username, turn.credential)) {
  throw new Error("verifyTurnCredential failed");
}
if (turnCredential("test-secret", turn.username) !== expected) {
  throw new Error("turnCredential helper mismatch");
}

const stunOnly = buildIceConfig();
delete process.env.TURN_URLS;
delete process.env.TURN_SECRET;
const noTurn = buildIceConfig();
if (noTurn.iceServers.some((s) => s.username)) {
  throw new Error("expected no TURN without env");
}

console.log("OK ice TURN creds", {
  username: turn.username,
  urls: turn.urls,
  policy: ice.iceTransportPolicy,
  stunOnlyCount: stunOnly.iceServers.length,
});
console.log("ICE UNIT PASS");
