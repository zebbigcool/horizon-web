import assert from "node:assert/strict";
import * as s from "./servers.js";

// normalize
assert.equal(s.normalize(" play.example.com "), "play.example.com");
assert.equal(s.normalize("host:25565"), "host:25565");
assert.equal(s.normalize("wss://eagler.example.org"), "wss://eagler.example.org");
assert.equal(s.normalize("not a host"), null);
assert.equal(s.normalize("javascript:alert(1)"), null);
assert.equal(s.normalize("wss://"), null);
// urls
assert.equal(s.socketUrl("host:1234", "https:"), "wss://host:1234/");
assert.equal(s.socketUrl("host:1234", "http:"), "ws://host:1234/");
assert.equal(s.socketUrl("wss://x.y/z"), "wss://x.y/z");
assert.equal(s.joinUrl("game.html", "wss://x.y"), "game.html?args=--server%20wss%3A%2F%2Fx.y");
// varints against known encodings
assert.deepEqual(s.readVarint(new Uint8Array([0xdd, 0xc7, 0x01])), { value: 25565, next: 3 });
assert.deepEqual(s.readVarint(new Uint8Array([0x80])), null);
// request: handshake packet = len, 0x00, protocol 777 (0x89 0x06), host, port, state 1; then 01 00
const req = s.statusRequest("a.b", 25565);
assert.deepEqual([...req.subarray(0, 4)], [10, 0x00, 0x89, 0x06]);
assert.deepEqual([...req.subarray(-2)], [1, 0]);
assert.equal(req[req.length - 3], 1); // next state = status
// responses, split across two messages
const json = JSON.stringify({ description: { text: "§aHello ", extra: [{ text: "world" }, "\n§7line2"] }, players: { online: 3, max: 20 }, version: { name: "26.3" } });
const body = new TextEncoder().encode(json);
const lenv = (n) => { const o = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; o.push(b); } while (n); return o; };
const inner = [0, ...lenv(body.length), ...body];
const packet = new Uint8Array([...lenv(inner.length), ...inner]);
assert.equal(s.readStatus(packet.subarray(0, 5)), null);
assert.deepEqual(s.fromVanilla(s.readStatus(packet)), { motd: ["Hello world", "line2"], online: 3, max: 20, version: "26.3" });
assert.deepEqual(s.fromEagler({ name: "N", vers: "1.12", type: "motd", data: { motd: ["§bA", "B"], online: 5, max: 60 } }), { name: "N", motd: ["A", "B"], online: 5, max: 60, version: "1.12" });

// query() end to end with fake sockets
class Fake {
  constructor(url) { this.url = url; Fake.last = this; setTimeout(() => this.onopen(), 1); }
  send(m) { this.sent = m; setTimeout(() => this.reply(m), 1); }
  close() { this.closed = true; }
}
globalThis.performance ??= { now: () => Date.now() };
Fake.prototype.reply = function (m) {
  if (typeof m === "string") this.onmessage({ data: JSON.stringify({ name: "E", vers: "1.12", type: "motd", data: { motd: ["hi"], online: 1, max: 9 } }) });
  else { this.onmessage({ data: packet.slice(0, 7).buffer }); this.onmessage({ data: packet.slice(7).buffer }); }
};
globalThis.location = { protocol: "http:" };
const a = await s.query("wss://e.example", Fake);
assert.equal(Fake.last.sent, "Accept: MOTD");
assert.deepEqual([a.motd, a.online, a.max], [["hi"], 1, 9]);
const b = await s.query("play.example.com:25570", Fake);
assert.equal(Fake.last.url, "ws://play.example.com:25570/");
assert.deepEqual([b.motd[0], b.online, b.max, typeof b.ping], ["Hello world", 3, 20, "number"]);
// failure
class Refuse { constructor() { setTimeout(() => this.onerror(), 1); } close() {} }
await assert.rejects(s.query("x.y", Refuse), /can't connect/);
console.log("servers ok");
