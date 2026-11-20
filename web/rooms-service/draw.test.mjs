// node --test web/rooms-service/draw.test.mjs : the draw-and-guess game's rules, with fake sockets and a fake clock.
import test from "node:test";
import assert from "node:assert/strict";
import { Draw, CHOOSE_MS, TURN_END_MS, GAME_END_MS, PUBLIC_START_MS, normalize, distance, parseCustom } from "./src/draw.js";

function setup() {
    const clock = { t: 1_000_000 };
    const game = new Draw({ now: () => clock.t, random: (() => { let s = 7; return () => ((s = (s * 48271) % 2147483647) / 2147483647); })() });
    const advance = (ms) => { clock.t += ms; game.tick(); };
    return { game, clock, advance };
}
function client(game, name, ip = "1.1.1.1") {
    const sock = { got: [], closed: null, send(t) { this.got.push(JSON.parse(t)); }, close(c, r) { this.closed = [c, r]; } };
    const conn = game.connect(sock, { ip });
    const c = {
        sock,
        say: (o) => conn.onMessage(JSON.stringify(o)),
        join: (o = {}) => c.say({ t: "join", name, sid: `sid-${name}`, av: [1, 2, 3, 4], mode: "create", ...o }),
        drop: () => conn.onClose(),
        of: (t) => sock.got.filter((m) => m.t === t),
        last: (t) => sock.got.filter((m) => m.t === t).at(-1),
        chats: () => sock.got.filter((m) => m.t === "chat").map((m) => `${m.kind}:${m.text}`),
    };
    return c;
}
const room = (c) => c.last("room");
// A started private game with the given names; the first is the host.
function started(names, settings = {}) {
    const s = setup();
    const cs = names.map((n) => client(s.game, n));
    cs[0].join();
    const code = room(cs[0]).code;
    cs.slice(1).forEach((c) => c.join({ mode: "code", code }));
    cs[0].say({ t: "settings", drawTime: 60, rounds: 2, hints: 2, ...settings });
    cs[0].say({ t: "start" });
    return { ...s, cs, code };
}
const drawerOf = (cs) => cs.find((c) => c.last("phase")?.words);
const pickFirst = (cs) => { const d = drawerOf(cs); d.say({ t: "pick", i: 0 }); return d; };

test("normalize and distance ignore case, accents, spaces and punctuation", () => {
    assert.equal(normalize("Ice-Cream "), "icecream");
    assert.equal(normalize("Éléphant"), "elephant");
    assert.equal(distance("cat", "cut"), 1);
    assert.equal(distance("kitten", "sitting"), 3);
    assert.deepEqual(parseCustom("a, b\nA, ,c"), ["a", "b", "c"]);
});

test("a private room: the creator is host, others join by code, the code is case-insensitive", () => {
    const { game } = setup();
    const a = client(game, "Ann");
    a.join();
    const snap = room(a);
    assert.equal(snap.public, false);
    assert.equal(snap.host, snap.you);
    assert.match(snap.code, /^[A-Z2-9]{6}$/);
    const b = client(game, "Bob");
    b.join({ mode: "code", code: snap.code.toLowerCase() });
    assert.equal(room(b).players.length, 2);
    assert.equal(a.last("players").players.length, 2);
    assert.ok(a.chats().some((c) => c.includes("Bob joined")));
    const c = client(game, "Cy");
    c.join({ mode: "code", code: "NOPE22" });
    assert.match(c.last("joinfail").msg, /no room/i);
});

test("names are made unique and avatars clamped", () => {
    const { game } = setup();
    const a = client(game, "Ann");
    a.join({ av: [99, -5, "x", 3] });
    const code = room(a).code;
    const b = client(game, "Ann");
    b.join({ mode: "code", code, name: "Ann" });
    assert.equal(room(b).players[1].name, "Ann (2)");
    assert.deepEqual(room(a).players[0].av, [15, 0, 0, 3]);
});

test("only the host starts, needs two players, and settings are clamped", () => {
    const s = setup();
    const a = client(s.game, "Ann");
    a.join();
    a.say({ t: "start" });
    assert.match(a.chats().at(-1), /at least 2/);
    const b = client(s.game, "Bob");
    b.join({ mode: "code", code: room(a).code });
    b.say({ t: "settings", rounds: 9 });
    assert.equal(a.last("settings"), undefined);
    a.say({ t: "settings", rounds: 99, drawTime: 1, wordCount: 3, hints: 2, maxPlayers: 1, mode: "bogus", custom: "x, y", customOnly: true });
    const st = a.last("settings").settings;
    assert.deepEqual([st.rounds, st.drawTime, st.maxPlayers, st.mode, st.custom, st.customOnly], [10, 15, 2, "normal", "x, y", true]);
    b.say({ t: "start" });
    assert.equal(a.last("phase"), undefined);
    a.say({ t: "start" });
    assert.equal(a.last("phase").phase, "choose");
    const drawer = drawerOf([a, b]);
    assert.deepEqual(drawer.last("phase").words.every((w) => ["x", "y"].includes(w)), true);
});

test("a turn: choose, draw, guess with points by time left, close guesses, drawer score, then everyone guessed", () => {
    const { cs, advance, clock } = started(["Ann", "Bob", "Cy"]);
    const d = drawerOf(cs);
    const [g1, g2] = cs.filter((c) => c !== d);
    assert.equal(g1.last("phase").phase, "choose");
    assert.equal(g1.last("phase").words, undefined, "guessers don't see the choices");
    const word = d.last("phase").words[0];
    d.say({ t: "pick", i: 0 });
    assert.equal(d.last("phase").word, word);
    assert.equal(g1.last("phase").word, undefined);
    assert.equal(g1.last("phase").mask.replace(/[^_]/g, "").length, [...word].filter((c) => /\p{L}/u.test(c)).length);
    advance(20_000); // a third of 60 s
    const near = word.slice(0, -1) + (word.endsWith("x") ? "y" : "x");
    g1.say({ t: "chat", text: near });
    assert.ok(g1.chats().some((c) => c.startsWith("close:")));
    assert.ok(g2.chats().includes(`msg:${near}`), "a wrong guess is public");
    assert.ok(!g2.chats().some((c) => c.startsWith("close:")), "but 'close' is only for the guesser");
    g1.say({ t: "chat", text: word.toUpperCase() });
    assert.equal(g1.last("word").word, word);
    assert.ok(g2.chats().some((c) => c.startsWith("correct:Bob") || c.startsWith("correct:Cy") || c.startsWith("correct:Ann")));
    assert.ok(!g2.chats().includes(`msg:${word.toUpperCase()}`), "a right guess isn't shown");
    const who = g1.last("players").players.find((p) => p.guessed);
    assert.equal(who.score, Math.round(50 + (450 * 40) / 60));
    // Guessed players chat with the drawer only.
    g1.say({ t: "chat", text: "easy one" });
    assert.ok(d.chats().includes("private:easy one"));
    assert.ok(!g2.chats().includes("private:easy one"));
    g2.say({ t: "chat", text: word });
    const end = d.last("turnend");
    assert.equal(end.word, word);
    assert.equal(end.reason, "everyone guessed it");
    const dp = d.last("players").players.find((p) => p.drawing === false && p.id === d.last("room").you);
    const g2Pts = Math.round(50 + (450 * 40) / 60);
    assert.equal(end.deltas[d.last("room").you], Math.round((2 * g2Pts) / 2));
    assert.equal(dp.score, end.deltas[d.last("room").you]);
    clock.t += 0;
});

test("the drawer can't chat the word; nobody else sees the drawer's chat", () => {
    const { cs } = started(["Ann", "Bob"]);
    const d = pickFirst(cs);
    const word = d.last("phase").word;
    d.say({ t: "chat", text: `it is ${word}!` });
    assert.match(d.chats().at(-1), /give away/);
    assert.ok(!cs.find((c) => c !== d).chats().some((c) => c.includes(word)));
});

test("hints reveal letters over time, never all of them, and the drawer isn't sent them", () => {
    const { cs, advance } = started(["Ann", "Bob"], { hints: 3, drawTime: 100 });
    const d = pickFirst(cs);
    const g = cs.find((c) => c !== d);
    const word = d.last("phase").word;
    const letters = [...word].filter((c) => /\p{L}/u.test(c)).length;
    for (let i = 0; i < 100; i++) advance(1000);
    const hints = g.of("hint");
    assert.equal(hints.length, Math.min(3, letters - 1, Math.floor(letters / 2)));
    assert.equal(d.of("hint").length, 0);
    const finalMask = hints.at(-1)?.mask ?? g.last("phase").mask;
    assert.ok(finalMask.includes("_"));
    assert.equal(g.last("turnend").reason, "time is up");
});

test("hidden mode shows no mask or hints; combination mode joins two words", () => {
    const h = started(["Ann", "Bob"], { mode: "hidden" });
    const d = pickFirst(h.cs);
    const g = h.cs.find((c) => c !== d);
    assert.equal(g.last("phase").hidden, true);
    assert.equal(g.last("phase").mask ?? null, null);
    const c = started(["Ann", "Bob"], { mode: "combination" });
    assert.ok(drawerOf(c.cs).last("phase").words.every((w) => w.includes(" ")));
});

test("the turns rotate through everyone, rounds count, then a podium and back to the lobby", () => {
    const { cs, advance } = started(["Ann", "Bob"], { rounds: 2 });
    const drawers = [];
    for (let turn = 0; turn < 4; turn++) {
        const d = cs.find((c) => c.last("phase").phase === "choose" && c.last("phase").words);
        assert.ok(d, `turn ${turn} has a drawer`);
        drawers.push(d.last("room").you);
        const g = cs.find((c) => c !== d);
        d.say({ t: "pick", i: 0 });
        g.say({ t: "chat", text: d.last("phase").word });
        advance(TURN_END_MS);
    }
    const [a, b] = [cs[0].last("room").you, cs[1].last("room").you];
    assert.deepEqual(drawers, [a, b, a, b], "everyone draws once per round");
    assert.equal(cs[0].last("phase").round, 2);
    const end = cs[0].last("gameend");
    assert.equal(end.ranking.length, 2);
    assert.equal(end.ranking[0].rank, 1);
    assert.ok(end.ranking[0].score >= end.ranking[1].score);
    advance(GAME_END_MS);
    assert.equal(cs[0].last("lobby").players.every((p) => p.score === 0), true);
});

test("an unpicked word is chosen for the drawer, and an unguessed turn ends with the word shown", () => {
    const { cs, advance } = started(["Ann", "Bob"], { drawTime: 30 });
    advance(CHOOSE_MS);
    const g = cs.find((c) => c.last("phase").words === undefined);
    assert.equal(g.last("phase").phase, "draw");
    advance(30_000);
    const end = g.last("turnend");
    assert.ok(end.word);
    assert.ok(Object.values(end.deltas).every((n) => n === 0));
});

test("only the drawer's ops are kept and relayed; undo and clear work; late joiners get the canvas", () => {
    const { cs, code, game } = started(["Ann", "Bob"]);
    const d = pickFirst(cs);
    const g = cs.find((c) => c !== d);
    g.say({ t: "d", o: { k: "s", c: "#ff0000", w: 8, p: [1, 1, 2, 2] } });
    assert.equal(d.of("d").length, 0);
    d.say({ t: "d", o: { k: "s", c: "#ff0000", w: 8, p: [10, 10, 20.4, 20, 9999, -4] } });
    d.say({ t: "d", o: { k: "m", p: [30, 30] } });
    d.say({ t: "d", o: { k: "f", x: 5, y: 5, c: "#00ff00" } });
    d.say({ t: "d", o: { k: "s", c: "javascript:", w: 3, p: [4, 4] } });
    assert.deepEqual(g.of("d").map((m) => m.o.k), ["s", "m", "f", "s"]);
    assert.deepEqual(g.of("d")[0].o.p, [10, 10, 20, 20, 800, 0]);
    assert.equal(g.of("d")[3].o.c, "#000000");
    d.say({ t: "d", o: { k: "u" } });
    const late = client(game, "Cy");
    late.join({ mode: "code", code });
    const canvas = room(late).canvas;
    assert.deepEqual(canvas.map((o) => o.k), ["s", "f"]);
    assert.deepEqual(canvas[0].p, [10, 10, 20, 20, 800, 0, 30, 30]);
    d.say({ t: "d", o: { k: "x" } });
    assert.equal(g.of("d").at(-1).o.k, "x");
});

test("likes and dislikes are counted per player and toggle off", () => {
    const { cs } = started(["Ann", "Bob", "Cy"]);
    const d = pickFirst(cs);
    const [a, b] = cs.filter((c) => c !== d);
    a.say({ t: "vote", v: 1 });
    b.say({ t: "vote", v: -1 });
    d.say({ t: "vote", v: 1 });
    assert.deepEqual([d.last("votes").up, d.last("votes").down], [1, 1]);
    a.say({ t: "vote", v: 1 });
    assert.equal(d.last("votes").up, 0);
});

test("the host kicks and bans; a banned player can't rejoin; the host can't be kicked; hosts hand over", () => {
    const { cs, code, game } = started(["Ann", "Bob", "Cy"]);
    const [a, b, c] = cs;
    b.say({ t: "kick", id: c.last("room").you });
    assert.equal(c.last("kicked"), undefined, "only the host");
    a.say({ t: "kick", id: a.last("room").you });
    assert.equal(a.last("kicked"), undefined);
    a.say({ t: "ban", id: b.last("room").you });
    assert.equal(b.last("kicked").ban, true);
    assert.equal(a.last("players").players.length, 2);
    const again = client(game, "Bob");
    again.join({ mode: "code", code });
    assert.match(again.last("joinfail").msg, /banned/);
    a.drop();
    assert.equal(c.last("host").id, c.last("room").you);
    assert.ok(c.chats().at(-1).includes("is the host now"));
});

test("vote kick needs a majority and at least 3 players", () => {
    const { cs } = started(["Ann", "Bob", "Cy", "Di"]);
    const [a, b, c, d] = cs;
    const target = d.last("room").you;
    a.say({ t: "votekick", id: target });
    a.say({ t: "votekick", id: target });
    assert.equal(d.last("kicked"), undefined);
    assert.ok(b.chats().at(-1).includes("(1/2)"));
    b.say({ t: "votekick", id: target });
    assert.equal(d.last("kicked").ban, true);
    assert.equal(c.last("players").players.length, 3);
});

test("if the drawer leaves the turn ends without scoring; with one player left the game ends", () => {
    const { cs } = started(["Ann", "Bob", "Cy"]);
    const d = pickFirst(cs);
    d.drop();
    const rest = cs.filter((c) => c !== d);
    assert.equal(rest[0].last("turnend").reason, "the drawer left");
    rest[1].drop();
    assert.ok(rest[0].last("gameend"));
});

test("public play: matches by language, fills one room, and counts down once two are in", () => {
    const { game, advance } = setup();
    const a = client(game, "Ann");
    a.join({ mode: "play", lang: "French" });
    assert.equal(room(a).public, true);
    assert.equal(room(a).host, null);
    const b = client(game, "Bob");
    b.join({ mode: "play", lang: "French" });
    const c = client(game, "Cy");
    c.join({ mode: "play", lang: "German" });
    assert.equal(room(b).code, room(a).code);
    assert.notEqual(room(c).code, room(a).code);
    assert.equal(a.last("countdown").ms, PUBLIC_START_MS);
    a.say({ t: "start" });
    assert.equal(a.last("phase"), undefined, "no host in a public room");
    advance(PUBLIC_START_MS);
    assert.equal(a.last("phase").phase, "choose");
    assert.equal(game.roomCount, 2);
    a.drop(); b.drop(); c.drop();
    assert.equal(game.roomCount, 0);
});

test("chat is limited in length and rate", () => {
    const { game } = setup();
    const a = client(game, "Ann");
    a.join();
    const b = client(game, "Bob");
    b.join({ mode: "code", code: room(a).code });
    a.say({ t: "chat", text: "x".repeat(300) + "<b>" });
    assert.equal(b.of("chat").find((m) => m.kind === "msg").text.length, 100);
    for (let i = 0; i < 10; i++) a.say({ t: "chat", text: `m${i}` });
    assert.equal(b.of("chat").filter((m) => m.kind === "msg").length, 6);
});
