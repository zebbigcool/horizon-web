// node web/rooms-service/registry.test.mjs
import assert from "node:assert/strict";
import { Registry, ONLINE_TTL_MS, ROOM_TTL_MS } from "./src/registry.js";

const r = new Registry();
const call = (m, p, b, t) => r.handle(m, p, b, t);

// Online: distinct tabs count once, and expire.
assert.deepEqual(call("POST", "/api/presence", { id: "a" }, 0), [200, { online: 1 }]);
assert.deepEqual(call("POST", "/api/presence", { id: "a" }, 1000), [200, { online: 1 }]);
assert.deepEqual(call("POST", "/api/presence", { id: "b" }, 2000), [200, { online: 2 }]);
assert.equal(call("POST", "/api/presence", {}, 0)[0], 400);
assert.deepEqual(call("GET", "/api/online", null, ONLINE_TTL_MS + 1500), [200, { online: 1 }]); // a expired, b not

// Rooms: heartbeat lists, the key protects, close removes, silence expires.
const room = { code: "ORNG-4271", key: "k1", owner: "zeb", name: "My World", players: 3, maxPlayers: 8 };
assert.equal(call("POST", "/api/rooms/heartbeat", room, 0)[0], 200);
assert.equal(call("POST", "/api/rooms/heartbeat", { ...room, key: "evil" }, 1)[0], 409);
call("POST", "/api/rooms/close", { code: room.code, key: "evil" }, 2);
let [, listed] = call("GET", "/api/rooms", null, 3);
assert.deepEqual(listed.rooms, [
    { code: "ORNG-4271", owner: "zeb", name: "My World", players: 3, maxPlayers: 8, public: true },
]);
call("POST", "/api/rooms/heartbeat", { ...room, players: 4 }, 5000);
assert.equal(call("GET", "/api/rooms", null, 6000)[1].rooms[0].players, 4);
assert.equal(call("GET", "/api/rooms", null, 5000 + ROOM_TTL_MS + 1)[1].rooms.length, 0); // expired
call("POST", "/api/rooms/heartbeat", room, 100000);
call("POST", "/api/rooms/close", { code: room.code, key: room.key }, 100001);
assert.equal(call("GET", "/api/rooms", null, 100002)[1].rooms.length, 0);

// Bad input and unknown paths.
assert.equal(call("POST", "/api/rooms/heartbeat", { code: "X" }, 0)[0], 400);
assert.equal(call("GET", "/nope", null, 0)[0], 404);
const clamped = new Registry();
clamped.heartbeat({ code: "C", key: "k", owner: "o".repeat(99), players: -5, maxPlayers: 99999 }, 0);
const [c] = clamped.list(0).rooms;
assert.equal(c.owner.length, 32);
assert.equal(c.players, 1);
assert.equal(c.maxPlayers, 1000);

console.log("registry tests passed");
