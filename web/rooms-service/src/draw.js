// The draw-and-guess game's server (a skribbl.io-style game): rooms, turns,
// word choice, hints, scoring, chat, the shared canvas, kicks and bans. Pure
// logic with no Cloudflare in it, so it can be tested with fake sockets and a fake
// clock (draw.test.mjs); index.js's DrawObject only wires WebSockets and a timer.
//
// Everything is JSON text over one WebSocket per player. Client -> server:
//   join {name, av, lang, sid, mode: "play" | "create" | "code", code}
//   settings {...} (host), start (host), kick {id} / ban {id} (host), votekick {id}
//   pick {i} (drawer)    d {o} (drawer: a drawing op)    chat {text}    vote {v: 1 | -1}
// Server -> client: joinfail, room (a full snapshot), players, settings, phase,
// word, hint, d, canvas, chat, votes, turnend, gameend, lobby, countdown, host, kicked.
import { LANGUAGES, WORDS } from "./draw-words.js";

export { LANGUAGES };
// How many colours, eyes, mouths and accessories the avatar editor has.
export const AVATAR = [16, 12, 12, 10];
export const RANGES = { maxPlayers: [2, 20], drawTime: [15, 240], rounds: [1, 10], wordCount: [1, 5], hints: [0, 5] };
export const MODES = ["normal", "hidden", "combination"];
export const DEFAULTS = {
    lang: "English",
    maxPlayers: 8,
    drawTime: 80,
    rounds: 3,
    wordCount: 3,
    hints: 2,
    mode: "normal",
    custom: [],
    customOnly: false,
};

export const CHOOSE_MS = 15_000;
export const TURN_END_MS = 5_000;
export const GAME_END_MS = 12_000;
export const PUBLIC_START_MS = 5_000;
const MAX_ROOMS = 400;
const MAX_NAME = 20;
const MAX_CHAT = 100;
const MAX_MESSAGE = 16_384;
const MAX_OPS = 3_000;
const MAX_POINTS = 40_000;
const MAX_STROKE_POINTS = 3_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const W = 800;
const H = 600;

const clamp = (n, [lo, hi], fallback) => {
    n = Math.round(Number(n));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const cleanText = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** What a guess is compared by: no case, accents, spaces or punctuation. */
export function normalize(s) {
    return String(s ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function distance(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 9;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = row;
    }
    return prev[b.length];
}

/** "custom, words\nhere" -> ["custom", "words", "here"] (kept short and few). */
export function parseCustom(text) {
    const parts = Array.isArray(text) ? text : String(text ?? "").split(/[,\n]/);
    const out = [];
    for (const part of parts) {
        const word = cleanText(part, 32);
        if (word.length >= 1 && !out.some((w) => w.toLowerCase() === word.toLowerCase())) out.push(word);
        if (out.length >= 500) break;
    }
    return out;
}

const isLetter = (ch) => /[\p{L}\p{N}]/u.test(ch);

export class Draw {
    constructor({ now = () => Date.now(), random = Math.random } = {}) {
        this.now = now;
        this.random = random;
        this.rooms = new Map();
        this.nextId = 1;
        this.connections = 0;
    }

    get roomCount() {
        return this.rooms.size;
    }

    /** A new socket: `sock` has send(text) and close(code, reason). Returns its handlers. */
    connect(sock, meta = {}) {
        this.connections++;
        const conn = { sock, ip: String(meta.ip ?? ""), player: null, room: null };
        return {
            onMessage: (data) => {
                if (typeof data !== "string" || data.length > MAX_MESSAGE) return;
                let msg;
                try {
                    msg = JSON.parse(data);
                } catch {
                    return;
                }
                if (!msg || typeof msg !== "object") return;
                try {
                    this.handle(conn, msg);
                } catch (e) {
                    console.warn("draw:", e);
                }
            },
            onClose: () => {
                if (conn.closed) return;
                conn.closed = true;
                this.connections--;
                if (conn.player) this.remove(conn.room, conn.player, "left");
            },
        };
    }

    // ---- messages in

    handle(conn, msg) {
        if (msg.t === "join") return this.join(conn, msg);
        const { room, player: p } = conn;
        if (!room || !p) return;
        switch (msg.t) {
            case "chat": return this.chat(room, p, msg.text);
            case "d": return this.drawOp(room, p, msg.o);
            case "pick": return this.pick(room, p, msg.i);
            case "vote": return this.vote(room, p, msg.v);
            case "votekick": return this.voteKick(room, p, msg.id);
            case "start": return this.start(room, p);
            case "settings": return this.setSettings(room, p, msg);
            case "kick": return this.hostRemove(room, p, msg.id, false);
            case "ban": return this.hostRemove(room, p, msg.id, true);
        }
    }

    join(conn, msg) {
        if (conn.player) return;
        const fail = (text) => this.send(conn.sock, { t: "joinfail", msg: text });
        const sid = cleanText(msg.sid, 40) || `s${this.nextId}-${Math.floor(this.random() * 1e9)}`;
        const lang = LANGUAGES.includes(msg.lang) ? msg.lang : "English";
        let room;
        if (msg.mode === "code") {
            room = this.rooms.get(String(msg.code ?? "").toUpperCase().trim());
            if (!room) return fail("There is no room with that code.");
        } else if (msg.mode === "create") {
            if (this.rooms.size >= MAX_ROOMS) return fail("The server is full right now. Try again in a minute.");
            room = this.newRoom(false, lang);
        } else {
            room = this.findPublic(lang, sid, conn.ip);
            if (!room) {
                if (this.rooms.size >= MAX_ROOMS) return fail("The server is full right now. Try again in a minute.");
                room = this.newRoom(true, lang);
            }
        }
        if (room.bannedSids.has(sid) || (conn.ip && room.bannedIps.has(conn.ip))) return fail("You are banned from this room.");
        if (room.players.size >= room.settings.maxPlayers) return fail("That room is full.");

        const name = this.uniqueName(room, cleanText(msg.name, MAX_NAME) || `Player${100 + Math.floor(this.random() * 900)}`);
        const av = AVATAR.map((n, i) => clamp(Array.isArray(msg.av) ? msg.av[i] : 0, [0, n - 1], 0));
        const p = { id: this.nextId++, conn, sid, name, av, score: 0, guessed: false, stamps: [] };
        conn.player = p;
        conn.room = room;
        room.players.set(p.id, p);
        if (!room.public && room.hostId === null) room.hostId = p.id;

        this.send(conn.sock, { t: "room", ...this.snapshot(room, p) });
        this.broadcast(room, { t: "players", players: this.view(room) });
        this.say(room, "sys", `${p.name} joined the room!`, p.id);
        this.sound(room, "join", p.id);
        this.maybeCountdown(room);
    }

    findPublic(lang, sid, ip) {
        let best = null;
        for (const room of this.rooms.values()) {
            if (!room.public || room.settings.lang !== lang || room.players.size >= room.settings.maxPlayers) continue;
            if (room.bannedSids.has(sid) || (ip && room.bannedIps.has(ip))) continue;
            if (room.phase === "gameend") continue;
            if (!best || room.players.size > best.players.size) best = room;
        }
        return best;
    }

    newRoom(isPublic, lang) {
        let code;
        do {
            code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)]).join("");
        } while (this.rooms.has(code));
        const room = {
            code,
            public: isPublic,
            settings: { ...DEFAULTS, lang, maxPlayers: isPublic ? 12 : DEFAULTS.maxPlayers, custom: [] },
            players: new Map(),
            hostId: null,
            phase: "lobby",
            round: 0,
            done: new Set(),
            drawerId: null,
            choices: [],
            word: null,
            ends: 0,
            turnStart: 0,
            hintsAt: [],
            revealed: new Set(),
            canvas: [],
            points: 0,
            votes: new Map(),
            turnScores: new Map(),
            used: new Set(),
            kickVotes: new Map(),
            bannedSids: new Set(),
            bannedIps: new Set(),
            startAt: 0,
            ranking: [],
            lastTurn: null,
        };
        this.rooms.set(code, room);
        return room;
    }

    uniqueName(room, name) {
        const taken = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
        if (!taken.has(name.toLowerCase())) return name;
        for (let n = 2; ; n++) {
            const tail = ` (${n})`;
            const candidate = name.slice(0, MAX_NAME - tail.length) + tail;
            if (!taken.has(candidate.toLowerCase())) return candidate;
        }
    }

    // ---- views

    view(room) {
        return [...room.players.values()].map((p) => ({
            id: p.id,
            name: p.name,
            av: p.av,
            score: p.score,
            guessed: p.guessed,
            host: p.id === room.hostId,
            drawing: p.id === room.drawerId && (room.phase === "choose" || room.phase === "draw"),
        }));
    }

    mask(room) {
        if (room.word === null || room.settings.mode === "hidden") return null;
        return [...room.word].map((ch, i) => (isLetter(ch) && !room.revealed.has(i) ? "_" : ch)).join("");
    }

    tally(room) {
        let up = 0;
        let down = 0;
        for (const v of room.votes.values()) v > 0 ? up++ : down++;
        return { up, down };
    }

    snapshot(room, p) {
        const left = (room.ends - this.now());
        return {
            you: p.id,
            code: room.code,
            public: room.public,
            host: room.hostId,
            settings: this.settingsView(room),
            players: this.view(room),
            phase: room.phase,
            round: room.round,
            rounds: room.settings.rounds,
            drawer: room.drawerId,
            ms: Math.max(0, left),
            mask: room.phase === "draw" ? this.mask(room) : null,
            hidden: room.settings.mode === "hidden",
            canvas: room.phase === "draw" ? room.canvas : [],
            votes: this.tally(room),
            countdown: room.startAt ? Math.max(0, room.startAt - this.now()) : 0,
            ranking: room.phase === "gameend" ? room.ranking : [],
            lastTurn: room.phase === "turnend" ? room.lastTurn : null,
        };
    }

    settingsView(room) {
        const s = room.settings;
        return { ...s, custom: s.custom.join(", ") };
    }

    // ---- sending

    send(sock, obj) {
        try {
            sock.send(JSON.stringify(obj));
        } catch {
            // a socket that already closed
        }
    }

    broadcast(room, obj, exceptId = null) {
        const text = JSON.stringify(obj);
        for (const p of room.players.values()) {
            if (p.id === exceptId) continue;
            try {
                p.conn.sock.send(text);
            } catch {
                // closed; onClose removes it
            }
        }
    }

    say(room, kind, text, exceptId = null, extra = {}) {
        this.broadcast(room, { t: "chat", kind, text, ...extra }, exceptId);
    }

    sound(room, name, exceptId = null) {
        this.broadcast(room, { t: "sound", name }, exceptId);
    }

    // ---- chat and guesses

    chat(room, p, raw) {
        const text = cleanText(raw, MAX_CHAT);
        if (!text) return;
        const now = this.now();
        p.stamps = p.stamps.filter((t) => now - t < 4000);
        if (p.stamps.length >= 6) return this.send(p.conn.sock, { t: "chat", kind: "sys", text: "Slow down a little." });
        p.stamps.push(now);

        const playing = room.phase === "draw";
        const isDrawer = p.id === room.drawerId;
        if (playing && !isDrawer && !p.guessed) {
            const guess = normalize(text);
            const word = normalize(room.word);
            if (guess && guess === word) return this.correct(room, p);
            this.say(room, "msg", text, null, { id: p.id, name: p.name });
            const near = word.length > 7 ? 2 : 1;
            if (guess.length >= 3 && distance(guess, word) <= near) {
                this.send(p.conn.sock, { t: "chat", kind: "close", text: `"${text}" is close!` });
            }
            return;
        }
        if (playing && isDrawer && normalize(text).includes(normalize(room.word))) {
            return this.send(p.conn.sock, { t: "chat", kind: "sys", text: "You can't give away the word." });
        }
        if (playing && (isDrawer || p.guessed)) {
            // Those who know the word talk among themselves.
            const out = JSON.stringify({ t: "chat", kind: "private", text, id: p.id, name: p.name });
            for (const q of room.players.values()) if (q.guessed || q.id === room.drawerId) q.conn.sock.send(out);
            return;
        }
        this.say(room, "msg", text, null, { id: p.id, name: p.name });
    }

    correct(room, p) {
        const total = room.settings.drawTime * 1000;
        const remaining = Math.max(0, room.ends - this.now());
        const points = Math.round(50 + (450 * remaining) / total);
        p.guessed = true;
        p.score += points;
        room.turnScores.set(p.id, points);
        this.say(room, "correct", `${p.name} guessed the word!`, null, { id: p.id });
        this.send(p.conn.sock, { t: "word", word: room.word });
        this.sound(room, "correct");
        this.broadcast(room, { t: "players", players: this.view(room) });
        this.checkAllGuessed(room);
    }

    checkAllGuessed(room) {
        if (room.phase !== "draw") return;
        const guessers = [...room.players.values()].filter((q) => q.id !== room.drawerId);
        if (guessers.length > 0 && guessers.every((q) => q.guessed)) this.endTurn(room, "everyone guessed it");
    }

    // ---- the canvas

    drawOp(room, p, o) {
        if (room.phase !== "draw" || p.id !== room.drawerId || !o || typeof o !== "object") return;
        const num = (v, max) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
        const colour = (c) => (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : "#000000");
        const points = (arr) => {
            if (!Array.isArray(arr)) return [];
            const out = [];
            for (let i = 0; i + 1 < arr.length && out.length < MAX_STROKE_POINTS; i += 2) out.push(num(arr[i], W), num(arr[i + 1], H));
            return out;
        };
        let op;
        switch (o.k) {
            case "s": {
                const pts = points(o.p);
                if (pts.length === 0 || room.canvas.length >= MAX_OPS || room.points + pts.length > MAX_POINTS) return;
                op = { k: "s", c: colour(o.c), w: Math.max(1, num(o.w, 80)), p: pts };
                room.canvas.push(op);
                room.points += pts.length;
                break;
            }
            case "m": {
                const last = room.canvas[room.canvas.length - 1];
                if (!last || last.k !== "s") return;
                const pts = points(o.p).slice(0, Math.max(0, MAX_STROKE_POINTS - last.p.length));
                if (pts.length === 0 || room.points + pts.length > MAX_POINTS) return;
                last.p.push(...pts);
                room.points += pts.length;
                op = { k: "m", p: pts };
                break;
            }
            case "f":
                if (room.canvas.length >= MAX_OPS) return;
                op = { k: "f", x: num(o.x, W), y: num(o.y, H), c: colour(o.c) };
                room.canvas.push(op);
                break;
            case "u": {
                const gone = room.canvas.pop();
                if (!gone) return;
                if (gone.k === "s") room.points -= gone.p.length;
                op = { k: "u" };
                break;
            }
            case "x":
                room.canvas = [];
                room.points = 0;
                op = { k: "x" };
                break;
            default:
                return;
        }
        this.broadcast(room, { t: "d", o: op }, p.id);
    }

    vote(room, p, v) {
        if (room.phase !== "draw" || p.id === room.drawerId) return;
        if (v !== 1 && v !== -1) return;
        if (room.votes.get(p.id) === v) room.votes.delete(p.id);
        else room.votes.set(p.id, v);
        this.broadcast(room, { t: "votes", ...this.tally(room) });
    }

    // ---- settings and the host

    setSettings(room, p, msg) {
        if (room.public || p.id !== room.hostId || room.phase !== "lobby") return;
        const s = room.settings;
        const next = {
            lang: LANGUAGES.includes(msg.lang) ? msg.lang : s.lang,
            maxPlayers: Math.max(room.players.size, clamp(msg.maxPlayers, RANGES.maxPlayers, s.maxPlayers)),
            drawTime: clamp(msg.drawTime, RANGES.drawTime, s.drawTime),
            rounds: clamp(msg.rounds, RANGES.rounds, s.rounds),
            wordCount: clamp(msg.wordCount, RANGES.wordCount, s.wordCount),
            hints: clamp(msg.hints, RANGES.hints, s.hints),
            mode: MODES.includes(msg.mode) ? msg.mode : s.mode,
            custom: msg.custom === undefined ? s.custom : parseCustom(String(msg.custom).slice(0, 8000)),
            customOnly: msg.customOnly === undefined ? s.customOnly : Boolean(msg.customOnly),
        };
        room.settings = next;
        this.broadcast(room, { t: "settings", settings: this.settingsView(room) });
    }

    start(room, p) {
        if (room.public || p.id !== room.hostId || room.phase !== "lobby") return;
        if (room.players.size < 2) return this.send(p.conn.sock, { t: "chat", kind: "sys", text: "You need at least 2 players to start." });
        if (room.settings.customOnly && room.settings.custom.length === 0) {
            return this.send(p.conn.sock, { t: "chat", kind: "sys", text: "Add some custom words, or turn off \"use only custom words\"." });
        }
        this.startGame(room);
    }

    hostRemove(room, p, id, ban) {
        if (room.public || p.id !== room.hostId) return;
        const target = room.players.get(Number(id));
        if (!target || target.id === p.id) return;
        this.kickOut(room, target, ban, ban ? "was banned from the room" : "was kicked from the room");
    }

    voteKick(room, p, id) {
        const target = room.players.get(Number(id));
        if (!target || target.id === p.id || room.players.size < 3) return;
        let voters = room.kickVotes.get(target.id);
        if (!voters) room.kickVotes.set(target.id, (voters = new Set()));
        if (voters.has(p.id)) return;
        voters.add(p.id);
        const needed = Math.floor((room.players.size - 1) / 2) + 1;
        this.say(room, "sys", `${p.name} voted to kick ${target.name} (${voters.size}/${needed}).`);
        if (voters.size >= needed) this.kickOut(room, target, true, "was kicked by vote");
    }

    kickOut(room, target, ban, how) {
        if (ban) {
            room.bannedSids.add(target.sid);
            if (target.conn.ip) room.bannedIps.add(target.conn.ip);
        }
        this.send(target.conn.sock, { t: "kicked", ban });
        this.say(room, "sys", `${target.name} ${how}.`, target.id);
        this.remove(room, target, "kicked");
        try {
            target.conn.sock.close(1000, "kicked");
        } catch {
            // already closed
        }
    }

    // ---- players leaving

    remove(room, p, why) {
        if (!room.players.delete(p.id)) return;
        p.conn.room = null;
        p.conn.player = null;
        for (const voters of room.kickVotes.values()) voters.delete(p.id);
        room.kickVotes.delete(p.id);
        room.votes.delete(p.id);
        room.done.delete(p.id);
        if (room.players.size === 0) {
            this.rooms.delete(room.code);
            return;
        }
        if (why === "left") this.say(room, "sys", `${p.name} left the room.`);
        this.sound(room, "leave");
        if (p.id === room.hostId) {
            room.hostId = [...room.players.keys()][0];
            const host = room.players.get(room.hostId);
            this.broadcast(room, { t: "host", id: room.hostId });
            this.say(room, "sys", `${host.name} is the host now.`);
        }
        this.broadcast(room, { t: "players", players: this.view(room) });
        if (room.phase === "lobby") return this.maybeCountdown(room);
        if (room.phase === "gameend") return;
        if (room.players.size < 2) return this.endGame(room);
        if (p.id === room.drawerId && (room.phase === "choose" || room.phase === "draw")) return this.endTurn(room, "the drawer left", false);
        this.checkAllGuessed(room);
    }

    // ---- the game

    maybeCountdown(room) {
        if (!room.public || room.phase !== "lobby") return;
        if (room.players.size >= 2 && !room.startAt) {
            room.startAt = this.now() + PUBLIC_START_MS;
            this.broadcast(room, { t: "countdown", ms: PUBLIC_START_MS });
        } else if (room.players.size < 2 && room.startAt) {
            room.startAt = 0;
            this.broadcast(room, { t: "countdown", ms: 0 });
        }
    }

    startGame(room) {
        room.startAt = 0;
        for (const p of room.players.values()) {
            p.score = 0;
            p.guessed = false;
        }
        room.round = 1;
        room.done.clear();
        room.used.clear();
        room.ranking = [];
        this.broadcast(room, { t: "countdown", ms: 0 });
        this.nextTurn(room);
    }

    nextTurn(room) {
        if (room.players.size < 2) return this.endGame(room);
        const eligible = () => [...room.players.values()].filter((p) => !room.done.has(p.id));
        let next = eligible()[0];
        if (!next) {
            room.round++;
            room.done.clear();
            if (room.round > room.settings.rounds) return this.endGame(room);
            next = eligible()[0];
        }
        room.done.add(next.id);
        this.beginChoose(room, next);
    }

    pickWords(room) {
        const { lang, wordCount, custom, customOnly, mode } = room.settings;
        const base = WORDS[lang] ?? WORDS.English;
        const pick = () => {
            if (custom.length && (customOnly || this.random() < 0.3)) return custom[Math.floor(this.random() * custom.length)];
            const one = () => base[Math.floor(this.random() * base.length)];
            return mode === "combination" ? `${one()} ${one()}` : one();
        };
        const out = [];
        const limit = customOnly ? Math.min(wordCount, custom.length) : wordCount;
        for (let tries = 0; out.length < limit && tries < 200; tries++) {
            const w = pick();
            const key = w.toLowerCase();
            if (out.some((o) => o.toLowerCase() === key) || (room.used.has(key) && tries < 100)) continue;
            out.push(w);
        }
        return out.length ? out : [base[0]];
    }

    beginChoose(room, drawer) {
        room.phase = "choose";
        room.drawerId = drawer.id;
        room.word = null;
        room.revealed = new Set();
        room.canvas = [];
        room.points = 0;
        room.votes.clear();
        room.turnScores.clear();
        room.lastTurn = null;
        for (const p of room.players.values()) p.guessed = false;
        room.choices = this.pickWords(room);
        room.ends = this.now() + CHOOSE_MS;
        const common = { t: "phase", phase: "choose", drawer: drawer.id, round: room.round, rounds: room.settings.rounds, ms: CHOOSE_MS };
        for (const p of room.players.values()) {
            this.send(p.conn.sock, p.id === drawer.id ? { ...common, words: room.choices } : common);
        }
        this.broadcast(room, { t: "players", players: this.view(room) });
        this.broadcast(room, { t: "canvas", ops: [] });
        this.broadcast(room, { t: "votes", up: 0, down: 0 });
        this.sound(room, "turn", null);
    }

    pick(room, p, i) {
        if (room.phase !== "choose" || p.id !== room.drawerId) return;
        const word = room.choices[Number(i)];
        if (word === undefined) return;
        this.beginDraw(room, word);
    }

    beginDraw(room, word) {
        const { drawTime, hints, mode } = room.settings;
        room.phase = "draw";
        room.word = word;
        room.used.add(word.toLowerCase());
        room.turnStart = this.now();
        room.ends = room.turnStart + drawTime * 1000;
        room.revealed = new Set();
        const letters = [...word].filter(isLetter).length;
        const count = mode === "hidden" ? 0 : Math.min(hints, Math.max(0, letters - 1), Math.floor(letters / 2) || 0);
        room.hintsAt = Array.from({ length: count }, (_, i) => {
            const frac = count === 1 ? 0.5 : 0.35 + (0.5 * i) / (count - 1);
            return room.turnStart + drawTime * 1000 * frac;
        });
        const common = { t: "phase", phase: "draw", drawer: room.drawerId, round: room.round, rounds: room.settings.rounds, ms: drawTime * 1000, hidden: mode === "hidden" };
        for (const p of room.players.values()) {
            this.send(p.conn.sock, p.id === room.drawerId ? { ...common, word } : { ...common, mask: this.mask(room) });
        }
        this.broadcast(room, { t: "players", players: this.view(room) });
    }

    revealHint(room) {
        const hidden = [];
        [...room.word].forEach((ch, i) => {
            if (isLetter(ch) && !room.revealed.has(i)) hidden.push(i);
        });
        if (hidden.length <= 1) return;
        room.revealed.add(hidden[Math.floor(this.random() * hidden.length)]);
        this.broadcast(room, { t: "hint", mask: this.mask(room) }, room.drawerId);
    }

    endTurn(room, reason, scoreDrawer = true) {
        if (room.phase !== "choose" && room.phase !== "draw") return;
        const drawer = room.players.get(room.drawerId);
        const deltas = {};
        for (const [id, pts] of room.turnScores) deltas[id] = pts;
        if (drawer && scoreDrawer && room.phase === "draw") {
            const sum = [...room.turnScores.values()].reduce((a, b) => a + b, 0);
            const others = Math.max(1, room.players.size - 1);
            const pts = Math.round(sum / others);
            drawer.score += pts;
            deltas[drawer.id] = pts;
        }
        room.lastTurn = { word: room.word, deltas, reason, votes: this.tally(room) };
        room.phase = "turnend";
        room.ends = this.now() + TURN_END_MS;
        this.broadcast(room, { t: "turnend", ...room.lastTurn, ms: TURN_END_MS });
        this.broadcast(room, { t: "players", players: this.view(room) });
        this.sound(room, "turnend");
    }

    endGame(room) {
        const sorted = [...room.players.values()].sort((a, b) => b.score - a.score);
        let rank = 0;
        let last = null;
        room.ranking = sorted.map((p, i) => {
            if (p.score !== last) rank = i + 1;
            last = p.score;
            return { id: p.id, name: p.name, av: p.av, score: p.score, rank };
        });
        room.phase = "gameend";
        room.drawerId = null;
        room.word = null;
        room.ends = this.now() + GAME_END_MS;
        this.broadcast(room, { t: "gameend", ranking: room.ranking, ms: GAME_END_MS });
        this.sound(room, "gameend");
    }

    toLobby(room) {
        room.phase = "lobby";
        room.round = 0;
        room.drawerId = null;
        room.word = null;
        room.canvas = [];
        room.points = 0;
        for (const p of room.players.values()) {
            p.score = 0;
            p.guessed = false;
        }
        this.broadcast(room, { t: "lobby", players: this.view(room) });
        this.maybeCountdown(room);
    }

    /** Called about once a second: timers for every room. */
    tick() {
        const now = this.now();
        for (const room of [...this.rooms.values()]) {
            switch (room.phase) {
                case "lobby":
                    if (room.startAt && now >= room.startAt) {
                        room.startAt = 0;
                        if (room.players.size >= 2) this.startGame(room);
                        else this.broadcast(room, { t: "countdown", ms: 0 });
                    }
                    break;
                case "choose":
                    if (now >= room.ends) this.beginDraw(room, room.choices[Math.floor(this.random() * room.choices.length)]);
                    break;
                case "draw":
                    while (room.hintsAt.length && now >= room.hintsAt[0]) {
                        room.hintsAt.shift();
                        this.revealHint(room);
                    }
                    if (now >= room.ends) this.endTurn(room, "time is up");
                    break;
                case "turnend":
                    if (now >= room.ends) this.nextTurn(room);
                    break;
                case "gameend":
                    if (now >= room.ends) this.toLobby(room);
                    break;
            }
        }
    }
}
