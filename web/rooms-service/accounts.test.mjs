// Run: node --test web/rooms-service/accounts.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { Accounts, MemoryStore, maskIp } from "./src/accounts.js";

const make = (opts = {}) => {
    const clock = { t: 1_000_000 };
    const store = new MemoryStore();
    const mk = () => new Accounts({ store, ownerPassword: "owner-secret-1", ipSecret: "k", iterations: 1000, now: () => clock.t, ...opts });
    return { clock, store, acc: mk(), again: mk };
};
const ok = (r) => {
    assert.ok(!r.error, r.error);
    return r;
};
const asOwner = async (acc) => ok(await acc.login("zeb", "owner-secret-1", "9.9.9.9")).token;
const player = async (acc, name, ip) => ok(await acc.signup(name, "password123", ip)).token;

test("sign up, log in, wrong password, rejected names", async () => {
    const { acc } = make();
    const t = await player(acc, "alice", "1.2.3.4");
    assert.equal((await acc.session(t)).name, "alice");
    assert.ok((await acc.login("ALICE", "password123", "1.2.3.4")).token);
    assert.equal((await acc.login("alice", "nope-nope-1", "1.2.3.4")).status, 401);
    assert.equal((await acc.signup("alice", "password123", "1.2.3.4")).status, 409);
    assert.equal((await acc.signup("zeb", "password123", "1.2.3.4")).status, 409);
    assert.ok((await acc.signup("a b", "password123", "1.2.3.4")).error);
    assert.ok((await acc.signup("bobby", "short", "1.2.3.4")).error);
    await acc.logout(t);
    assert.equal(await acc.session(t), null);
});

test("accounts and sessions survive a restart; passwords aren't stored", async () => {
    const { acc, store, again } = make();
    const t = await player(acc, "alice", "1.2.3.4");
    const fresh = again();
    assert.equal((await fresh.session(t)).name, "alice");
    assert.ok((await fresh.login("alice", "password123", "1.2.3.4")).token);
    assert.ok(![...store.map.values()].some((v) => JSON.stringify(v).includes("password123")));
});

test("the owner logs in only with the secret; without one nobody can", async () => {
    const { acc } = make();
    assert.equal((await acc.login("Zeb", "wrong-password", "9.9.9.9")).status, 401);
    const me = ok(await acc.login("Zeb", "owner-secret-1", "9.9.9.9")).me;
    assert.equal(me.role, "owner");
    assert.deepEqual(me.nametag, { mode: "rainbow" });
    const { acc: unset } = make({ ownerPassword: "" });
    assert.equal((await unset.login("Zeb", "", "9.9.9.9")).status, 503);
});

test("repeated wrong passwords are slowed down", async () => {
    const { acc } = make();
    for (let i = 0; i < 6; i++) await acc.login("Zeb", "bad-bad-bad", "5.5.5.5");
    assert.equal((await acc.login("Zeb", "owner-secret-1", "5.5.5.5")).status, 429);
});

test("only the owner sets a nametag, rainbow or a color", async () => {
    const { acc } = make();
    const p = await player(acc, "alice", "1.1.1.1");
    assert.equal((await acc.setNametag(p, "rainbow")).status, 403);
    const o = await asOwner(acc);
    assert.deepEqual(ok(await acc.setNametag(o, "color", "#FF8A1F")).me.nametag, { mode: "color", color: "#ff8a1f" });
    assert.ok((await acc.setNametag(o, "color", "orange")).error);
    assert.deepEqual(ok(await acc.setNametag(o, "rainbow")).me.nametag, { mode: "rainbow" });
});

test("roles: only the owner promotes; ranks limit who can act on whom", async () => {
    const { acc } = make();
    const o = await asOwner(acc);
    const [a, b, c, d] = [await player(acc, "adam", "1.0.0.1"), await player(acc, "bella", "1.0.0.2"), await player(acc, "carl", "1.0.0.3"), await player(acc, "dina", "1.0.0.4")];
    assert.equal((await acc.setRole(a, "bella", "mod")).status, 403);
    ok(await acc.setRole(o, "adam", "admin"));
    ok(await acc.setRole(o, "bella", "janitor"));
    ok(await acc.setRole(o, "carl", "mod"));
    assert.equal((await acc.setRole(o, "zeb", "user")).status, 400);
    assert.equal((await acc.setRole(o, "dina", "owner")).error, "Unknown role.");
    // a mod can kick but not ban
    ok(await acc.kick(c, "dina"));
    assert.equal((await acc.ban(c, "dina")).status, 403);
    // a janitor can ban but not IP ban, and can't touch a higher rank
    ok(await acc.ban(b, "dina"));
    assert.equal((await acc.ipBan(b, "dina")).status, 403);
    assert.equal((await acc.kick(b, "adam")).status, 403);
    // an admin can IP ban, but not the owner
    ok(await acc.ipBan(a, "dina"));
    assert.equal((await acc.kick(a, "zeb")).status, 403);
    // a plain user can do nothing
    assert.equal((await acc.kick(d, "carl")).status, 403);
});

test("kick blocks for a while; ban and IP ban show on the ping", async () => {
    const { acc, clock } = make();
    const o = await asOwner(acc);
    const p = await player(acc, "alice", "1.2.3.4");
    ok(await acc.kick(o, "alice"));
    const k = (await acc.ping(p, "1.2.3.4")).status.kickedUntil;
    assert.ok(k > clock.t);
    clock.t = k + 1;
    assert.equal((await acc.ping(p, "1.2.3.4")).status.kickedUntil, 0);
    ok(await acc.ban(o, "alice"));
    assert.equal((await acc.ping(p, "1.2.3.4")).status.banned, true);
    ok(await acc.ipBan(o, "alice"));
    assert.equal((await acc.ping("", "1.2.3.4")).status.ipBanned, true);
    assert.equal((await acc.ping("", "1.2.9.9")).status.ipBanned, false);
    assert.equal((await acc.signup("newbie", "password123", "1.2.3.4")).status, 403);
    assert.equal((await acc.login("alice", "password123", "1.2.3.4")).status, 403);
});

test("every action is undoable, by someone who could have done it", async () => {
    const { acc } = make();
    const o = await asOwner(acc);
    const adm = await player(acc, "adam", "2.0.0.1");
    const mod = await player(acc, "moddy", "2.0.0.2");
    const p = await player(acc, "alice", "2.0.0.3");
    const role = ok(await acc.setRole(o, "adam", "admin")).action;
    ok(await acc.setRole(o, "moddy", "mod"));

    const kick = ok(await acc.kick(mod, "alice")).action;
    const ban = ok(await acc.ban(adm, "alice")).action;
    const ipban = ok(await acc.ipBan(adm, "alice")).action;

    // the mod can't undo the admin's ban; the admin can
    assert.equal((await acc.undo(mod, ban.id)).status, 403);
    ok(await acc.undo(adm, ipban.id));
    ok(await acc.undo(adm, ban.id));
    ok(await acc.undo(mod, kick.id));
    assert.deepEqual((await acc.ping(p, "2.0.0.3")).status, { banned: false, kickedUntil: 0, ipBanned: false });
    assert.equal((await acc.undo(adm, ban.id)).error, "Already undone.");

    // only the owner undoes a role change, and the old role returns
    assert.equal((await acc.undo(adm, role.id)).status, 403);
    ok(await acc.undo(o, role.id));
    assert.equal((await acc.session(adm)).role, "user");

    const log = ok(await acc.log(o)).actions;
    assert.equal(log.length, 5);
    assert.ok(log.every((a) => a.undone || a.id === log.find((x) => x.type === "role" && x.target === "moddy").id));
});

test("the IP ban list shows masked networks and unbanning is itself undoable", async () => {
    const { acc } = make();
    const o = await asOwner(acc);
    await player(acc, "alice", "203.0.113.77");
    ok(await acc.ipBan(o, "alice"));
    const [b] = ok(await acc.ipBans(o)).bans;
    assert.equal(b.mask, "203.0.*.*");
    assert.ok(!JSON.stringify(b).includes("113"));
    const un = ok(await acc.unbanIp(o, b.id)).action;
    assert.equal(await acc.ipBanned("203.0.113.77"), false);
    ok(await acc.undo(o, un.id));
    assert.equal(await acc.ipBanned("203.0.113.77"), true);
    assert.equal(maskIp("2001:db8:1:2::3"), "2001:db8:*");
});

test("an admin can't ban their own network", async () => {
    const { acc } = make();
    const o = await asOwner(acc);
    const a = await player(acc, "adam", "7.7.7.7");
    ok(await acc.setRole(o, "adam", "admin"));
    await player(acc, "sibling", "7.7.7.7");
    assert.ok((await acc.ipBan(a, "sibling")).error);
});

test("search lists players with their skin name, staff only", async () => {
    const { acc } = make();
    const o = await asOwner(acc);
    const p = await player(acc, "alice", "1.1.1.1");
    await player(acc, "alina", "1.1.1.2");
    ok(await acc.setSkin(p, "Steve"));
    assert.equal((await acc.search(p, "ali")).status, 403);
    const { users } = ok(await acc.search(o, "ali"));
    assert.deepEqual(users.map((u) => [u.name, u.skin, u.role]), [["alice", "Steve", "user"], ["alina", "", "user"]]);
    assert.deepEqual(ok(await acc.search(o, "steve")).users.map((u) => u.name), ["alice"]);
});

test("announcement and shout: owner only, replaced or cleared, heard on the ping", async () => {
    const { acc } = make();
    const o = await asOwner(acc);
    const p = await player(acc, "alice", "1.1.1.1");
    assert.equal((await acc.setNotice(p, "shout", "hi")).status, 403);
    const first = ok(await acc.setNotice(o, "announcement", "hi $r$all$r$")).announcement;
    ok(await acc.setNotice(o, "shout", "Server up!"));
    let ping = await acc.ping(p, "1.1.1.1");
    assert.equal(ping.announcement.text, "hi $r$all$r$");
    assert.equal(ping.announcement.by, "Zeb");
    assert.equal(ping.shout.text, "Server up!");
    const second = ok(await acc.setNotice(o, "announcement", "new one")).announcement;
    assert.notEqual(second.id, first.id);
    ok(await acc.setNotice(o, "shout", ""));
    ping = await acc.ping("", "8.8.8.8");
    assert.equal(ping.shout, null);
    assert.equal(ping.announcement.text, "new one");
    assert.equal(ping.me, null);
});

test("cloud save: chunks are kept, replaced by a newer save, and private to the account", async () => {
    const { acc } = make();
    const a = await player(acc, "alice", "1.1.1.1");
    const b = await player(acc, "bobby", "1.1.1.2");
    ok(await acc.putData(a, "g1", 0, 2, "AAA"));
    ok(await acc.putData(a, "g1", 1, 2, "BBB"));
    assert.equal(ok(await acc.getData(a, 1)).chunk, "BBB");
    assert.equal((await acc.getData(b, 0)).status, 404);
    ok(await acc.putData(a, "g2", 0, 1, "NEW"));
    assert.equal(ok(await acc.dataInfo(a)).data.chunks, 1);
    assert.equal(ok(await acc.getData(a, 0)).chunk, "NEW");
    assert.equal((await acc.putData(a, "g3", 0, 99, "x")).error, "Bad chunk.");
    ok(await acc.deleteData(a));
    assert.equal((await acc.getData(a, 0)).status, 404);
});

test("handle routes by path and never leaks the token logic to GET", async () => {
    const { acc } = make();
    const [s, r] = await acc.handle("POST", "/api/account/signup", { name: "alice", password: "password123" }, "1.1.1.1");
    assert.equal(s, 200);
    const [s2] = await acc.handle("POST", "/api/staff/kick", { token: r.token, name: "x" }, "1.1.1.1");
    assert.equal(s2, 403);
    assert.deepEqual((await acc.handle("GET", "/api/site", null, ""))[1], { announcement: null, shout: null, owner: null });
    assert.equal((await acc.handle("POST", "/api/nope", {}, ""))[0], 404);
});

test("a username is unique and fixed; a display name is free to copy and is what others see", async () => {
    const { acc } = make();
    const a = await player(acc, "alice", "1.1.1.1");
    const b = await player(acc, "bobby", "1.1.1.2");
    assert.equal(ok(await acc.setDisplay(a, "Cool_Name")).me.display, "Cool_Name");
    // the same display name can be taken by someone else (like a Discord display name)...
    assert.equal(ok(await acc.setDisplay(b, "Cool_Name")).me.display, "Cool_Name");
    // ...but a username can't, however it is spelled
    assert.equal((await acc.signup("ALICE", "password123", "1.1.1.3")).status, 409);
    assert.equal((await acc.signup("zeb", "password123", "1.1.1.3")).status, 409);
    // a display name can be used as a Minecraft name, so no spaces and at most 16 characters
    assert.ok((await acc.setDisplay(a, "has space")).error);
    assert.ok((await acc.setDisplay(a, "x".repeat(17))).error);
    // copying a display name gives nothing: staff and actions go by username
    const o = await asOwner(acc);
    const { users } = ok(await acc.search(o, "cool_name"));
    assert.deepEqual(users.map((u) => [u.name, u.display]), [["alice", "Cool_Name"], ["bobby", "Cool_Name"]]);
    ok(await acc.kick(o, "bobby"));
    assert.equal((await acc.ping(a, "1.1.1.1")).status.kickedUntil, 0);
    assert.ok((await acc.ping(b, "1.1.1.2")).status.kickedUntil > 0);
    assert.equal((await acc.ping(a, "1.1.1.1")).me.display, "Cool_Name");
});

test("shout poll: 2 to 8 options, one vote per account (changeable), results for all, reset by a new shout", async () => {
    const { acc } = make();
    const o = await asOwner(acc);
    const a = await player(acc, "alice", "1.1.1.1");
    const b = await player(acc, "bobby", "1.1.1.2");
    assert.ok((await acc.setNotice(o, "shout", "Map?", ["only one"])).error);
    assert.ok((await acc.setNotice(o, "shout", "Map?", ["a", "A"])).error);
    assert.ok((await acc.setNotice(o, "shout", "Map?", Array.from({ length: 9 }, (_, i) => `o${i}`))).error);
    const made = ok(await acc.setNotice(o, "shout", "Which map?", ["Desert", "Forest", " ", "Ocean"])).shout;
    assert.deepEqual(made.poll.options.map((x) => x.text), ["Desert", "Forest", "Ocean"]);
    assert.equal((await acc.vote("", 0)).status, 401);
    ok(await acc.vote(a, 1));
    ok(await acc.vote(b, 1));
    assert.equal(ok(await acc.vote(a, 2)).shout.poll.mine, 2); // changed her mind
    assert.ok((await acc.vote(a, 3)).error);
    assert.ok((await acc.vote(a, "1")).error);
    const seenA = (await acc.ping(a, "1.1.1.1")).shout.poll;
    assert.deepEqual(seenA.options.map((x) => x.votes), [0, 1, 1]);
    assert.equal(seenA.total, 2);
    assert.equal(seenA.mine, 2);
    const anon = (await acc.ping("", "8.8.8.8")).shout.poll;
    assert.equal(anon.mine, null);
    assert.equal(anon.total, 2);
    // a shout without options is plain, and a new shout starts a fresh poll
    ok(await acc.setNotice(o, "shout", "Plain"));
    assert.equal((await acc.ping(a, "1.1.1.1")).shout.poll, undefined);
    assert.equal((await acc.vote(a, 0)).status, 404);
    ok(await acc.setNotice(o, "shout", "Again", ["x", "y"]));
    assert.equal((await acc.ping(a, "1.1.1.1")).shout.poll.total, 0);
    assert.equal((await acc.ping("", "8.8.8.8")).shout.poll.options.length, 2);
});
