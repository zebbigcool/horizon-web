import assert from "node:assert/strict";
import { Relay } from "./src/relay.js";

const enc = new TextEncoder();
const str8 = (s) => [s.length, ...enc.encode(s)];
const bytes16 = (s) => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
const readStr8 = (b, o) => [String.fromCharCode(...b.subarray(o + 1, o + 1 + b[o])), o + 1 + b[o]];
const readBytes16 = (b, o) => { const n = (b[o] << 8) | b[o + 1]; return [String.fromCharCode(...b.subarray(o + 2, o + 2 + n)), o + 2 + n]; };

function fake(relay) {
    const sock = { got: [], closed: null, send(b) { this.got.push(b); }, close(code, reason) { this.closed = [code, reason]; } };
    const conn = relay.connect(sock);
    sock.say = (bytes) => conn.onMessage(new Uint8Array(bytes));
    sock.drop = () => conn.onClose();
    return sock;
}
const ids = (s) => s.got.map((b) => b[0]);

const relay = new Relay({ random: () => 0.5 });
const host = fake(relay);
host.say([0x00, 1, 1, ...str8("my world")]);
// Handshake answer: code at offset 3, then the ICE servers.
assert.equal(host.got[0][0], 0x00);
const [code] = readStr8(host.got[0], 3);
assert.match(code, /^[a-z0-9]{5}$/);
assert.equal(host.got[1][0], 0x01);
assert.equal((host.got[1][1] << 8) | host.got[1][2], 3);

// Unknown code: error 5.
const lost = fake(relay);
lost.say([0x00, 2, 1, ...str8("zzzzz")]);
assert.deepEqual([...lost.got[0]], [0xff, 5]);
assert.ok(lost.closed);

// A player joins: gets ICE servers, the host hears of the player.
const player = fake(relay);
player.say([0x00, 2, 1, ...str8(code.toUpperCase())]);
assert.deepEqual(ids(player), [0x01]);
assert.equal(host.got[2][0], 0x02);
const [pid] = readStr8(host.got[2], 1);

// Offer goes to the host tagged with the player; the answer comes back.
player.say([0x04, ...str8(""), ...bytes16("OFFER")]);
let m = host.got.at(-1);
assert.equal(m[0], 0x04);
const [from, o] = readStr8(m, 1);
assert.equal(from, pid);
assert.equal(readBytes16(m, o)[0], "OFFER");
host.say([0x04, ...str8(pid), ...bytes16("ANSWER")]);
m = player.got.at(-1);
assert.equal(m[0], 0x04);
assert.equal(readBytes16(m, readStr8(m, 1)[1])[0], "ANSWER");
player.say([0x03, ...str8(""), ...bytes16("[]")]);
assert.equal(host.got.at(-1)[0], 0x03);
host.say([0x03, ...str8(pid), ...bytes16("[]")]);
assert.equal(player.got.at(-1)[0], 0x03);

// After success the player's close doesn't tell the host to drop the link.
const before = host.got.length;
player.say([0x05, ...str8("")]);
player.drop();
assert.equal(host.got.length, before);

// A player that leaves early does.
const early = fake(relay);
early.say([0x00, 2, 1, ...str8(code)]);
const sent = host.got.length;
early.drop();
assert.equal(host.got.length, sent + 1);
assert.equal(host.got.at(-1)[0], 0xfe);

// The host leaving frees the code and drops the others.
const waiting = fake(relay);
waiting.say([0x00, 2, 1, ...str8(code)]);
host.drop();
assert.ok(waiting.closed);
const late = fake(relay);
late.say([0x00, 2, 1, ...str8(code)]);
assert.deepEqual([...late.got[0]], [0xff, 5]);

// Garbage closes the socket instead of throwing.
const bad = fake(relay);
bad.say([0x00, 1]);
assert.ok(bad.closed);
console.log("relay ok");
