// node web/rooms-service/worker.test.mjs : the real Worker's routing, with the Durable Objects in memory.
import test from "node:test";
import assert from "node:assert/strict";
import { makeWorker } from "./fake-env.mjs";

const BASE = "https://rooms.test";
const call = (worker, method, path, body, ip = "1.1.1.1") =>
    worker.fetch(new Request(BASE + path, {
        method,
        headers: { "Content-Type": "text/plain", "CF-Connecting-IP": ip },
        body: body === undefined ? undefined : JSON.stringify(body),
    }));
const post = async (worker, path, body, ip) => {
    const r = await call(worker, "POST", path, body, ip);
    return [r.status, await r.json(), r];
};

test("presence counts tabs and carries the site notices; every answer has CORS", async () => {
    const w = await makeWorker({ ADMIN_PASSWORD: "owner-secret-1" });
    const [, owner] = await post(w, "/api/account/login", { name: "Zeb", password: "owner-secret-1" }, "9.9.9.9");
    assert.ok(owner.token);
    assert.equal((await post(w, "/api/owner/shout", { token: owner.token, text: "hello $r$all$r$" }))[0], 200);
    assert.equal((await post(w, "/api/owner/announce", { token: owner.token, text: "big news" }))[0], 200);
    const [s, data, res] = await post(w, "/api/presence", { id: "tab-1" });
    assert.equal(s, 200);
    assert.equal(data.online, 1);
    assert.equal(data.site.shout.text, "hello $r$all$r$");
    assert.equal(data.site.announcement.text, "big news");
    assert.equal(data.site.owner.name, "Zeb");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const bad = await post(w, "/api/account/login", { name: "Zeb", password: "nope" });
    assert.equal(bad[0], 401);
    assert.equal(bad[2].headers.get("access-control-allow-origin"), "*");
    const site = await (await call(w, "GET", "/api/site")).json();
    assert.equal(site.shout.by, "Zeb");
});

test("without the ADMIN_PASSWORD secret the owner can't log in", async () => {
    const w = await makeWorker({});
    assert.equal((await post(w, "/api/account/login", { name: "Zeb", password: "" }))[0], 503);
});

test("staff actions over HTTP; an IP ban stops sign-ups and the relay, and unbanning lifts it", async () => {
    const w = await makeWorker({ ADMIN_PASSWORD: "owner-secret-1" });
    const [, o] = await post(w, "/api/account/login", { name: "Zeb", password: "owner-secret-1" }, "9.9.9.9");
    const [, a] = await post(w, "/api/account/signup", { name: "alice", password: "password123" }, "5.6.7.8");
    // a ping makes the account's network known
    await post(w, "/api/presence", { id: "t", token: a.token }, "5.6.7.8");
    const [, found] = await post(w, "/api/staff/search", { token: o.token, q: "ali" });
    assert.deepEqual(found.users.map((u) => u.name), ["alice"]);
    assert.equal((await post(w, "/api/staff/role", { token: o.token, name: "alice", role: "mod" }))[0], 200);
    assert.equal((await post(w, "/api/staff/ban", { token: a.token, name: "zeb" }))[0], 403);
    assert.equal((await post(w, "/api/staff/role", { token: o.token, name: "alice", role: "user" }))[0], 200);

    const [, kicked] = await post(w, "/api/staff/kick", { token: o.token, name: "alice" });
    let [, ping] = await post(w, "/api/presence", { id: "t", token: a.token }, "5.6.7.8");
    assert.ok(ping.site.status.kickedUntil > Date.now());
    await post(w, "/api/staff/undo", { token: o.token, id: kicked.action.id });
    [, ping] = await post(w, "/api/presence", { id: "t", token: a.token }, "5.6.7.8");
    assert.equal(ping.site.status.kickedUntil, 0);

    assert.equal((await post(w, "/api/staff/ipban", { token: o.token, name: "alice" }))[0], 200);
    assert.equal((await post(w, "/api/account/signup", { name: "other", password: "password123" }, "5.6.7.8"))[0], 403);
    const relay = await call(w, "GET", "/relay", undefined, "5.6.7.8");
    assert.equal(relay.status, 403);
    [, ping] = await post(w, "/api/presence", { id: "t2" }, "5.6.7.8");
    assert.equal(ping.site.status.ipBanned, true);

    const [, list] = await post(w, "/api/staff/ipbans", { token: o.token });
    assert.equal(list.bans[0].mask, "5.6.*.*");
    assert.equal((await post(w, "/api/staff/unipban", { token: o.token, id: list.bans[0].id }))[0], 200);
    assert.equal((await post(w, "/api/account/signup", { name: "other", password: "password123" }, "5.6.7.8"))[0], 200);
    // the registry's own routes still work
    assert.equal((await post(w, "/api/rooms/heartbeat", { code: "ABC", key: "k", owner: "x", players: 1 }))[0], 200);
    assert.equal((await (await call(w, "GET", "/api/rooms")).json()).rooms.length, 1);
});

test("an oversized body is refused", async () => {
    const w = await makeWorker({});
    assert.equal((await post(w, "/api/account/login", { name: "x", password: "y".repeat(5000) }))[0], 413);
});
