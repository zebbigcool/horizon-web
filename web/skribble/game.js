// doodle dash: the page's client. The rules live on the server (rooms-service/src/draw.js);
// this draws the screens, the shared canvas, the chat and the sounds.
import { ROOMS_APIS } from "../config.js";
import { avatar, COUNTS, randomAvatar } from "./avatar.js";

const $ = (id) => document.getElementById(id);
const LANGS = ["English", "Spanish", "French", "German", "Portuguese", "Italian", "Dutch"];
const GAME_ID = "doodle-dash";
const W = 800;
const H = 600;
const COLOURS = [
    "#ffffff", "#c8ccd4", "#8a909c", "#4a4f5c", "#000000", "#ff3b3b", "#c41e3a", "#ff8a1f", "#ffd23f", "#f5e6a8", "#9be04a", "#2fbf5b",
    "#0b7a3c", "#2fd3d0", "#3fa7ff", "#3478f6", "#1d2f9c", "#7a3fd0", "#f06bd0", "#ffb3c7", "#c9a27e", "#8b5a2b", "#5a3b1e", "#e8c9a0",
];
const SIZES = [4, 10, 20, 36, 60];

const store = {
    get(key, fallback = "") {
        try {
            return localStorage.getItem(`doodle.${key}`) ?? fallback;
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(`doodle.${key}`, value);
        } catch {
            // private window: nothing is remembered
        }
    },
};

const el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids);
    return node;
};

// ---- state

const G = {
    ws: null,
    left: false, // the player chose to leave: not a lost connection
    me: 0,
    code: "",
    isPublic: false,
    host: null,
    settings: null,
    players: [],
    phase: "lobby",
    round: 0,
    rounds: 0,
    drawer: null,
    endsAt: 0,
    countdownEnd: 0,
    mask: null,
    hidden: false,
    word: null,
    choices: null,
    ranking: [],
    turn: null,
    muted: new Set(),
    myVote: 0,
};
let av = [0, 0, 0, 0];

// ---- sound

let audio = null;
let soundOn = store.get("sound", "1") === "1";
function tone(freq, start, length, type = "sine", volume = 0.15) {
    if (!soundOn) return;
    try {
        audio ??= new AudioContext();
        if (audio.state === "suspended") audio.resume();
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        const t = audio.currentTime + start;
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(volume, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
        osc.connect(gain).connect(audio.destination);
        osc.start(t);
        osc.stop(t + length + 0.02);
    } catch {
        // no audio here
    }
}
const SOUNDS = {
    correct: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.18, "triangle")),
    join: () => tone(660, 0, 0.12, "sine", 0.08),
    leave: () => tone(330, 0, 0.14, "sine", 0.08),
    turn: () => {
        if (G.drawer === G.me) [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.1, 0.2, "square", 0.08));
    },
    tick: () => tone(880, 0, 0.06, "square", 0.06),
    turnend: () => [494, 392, 330].forEach((f, i) => tone(f, i * 0.12, 0.2, "triangle")),
    gameend: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.25, "triangle")),
    hint: () => tone(740, 0, 0.1, "sine", 0.1),
};
const play = (name) => SOUNDS[name]?.();
function showSound() {
    $("sound").textContent = soundOn ? "🔊" : "🔇";
}
$("sound").addEventListener("click", () => {
    soundOn = !soundOn;
    store.set("sound", soundOn ? "1" : "0");
    showSound();
    play("join");
});
showSound();

// ---- home

const params = new URLSearchParams(location.search);
let inviteCode = (params.get("room") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

function loadAvatar() {
    try {
        const saved = JSON.parse(store.get("av", "null"));
        if (Array.isArray(saved) && saved.length === 4) return COUNTS.map((n, i) => Math.min(n - 1, Math.max(0, Math.round(Number(saved[i]) || 0))));
    } catch {
        // fall through
    }
    return randomAvatar();
}
av = loadAvatar();
function showAvatar() {
    $("av-preview").innerHTML = avatar(av);
    store.set("av", JSON.stringify(av));
}
showAvatar();
for (const button of document.querySelectorAll("[data-part]")) {
    button.addEventListener("click", () => {
        const part = Number(button.dataset.part);
        av[part] = (av[part] + Number(button.dataset.dir) + COUNTS[part]) % COUNTS[part];
        showAvatar();
    });
}
$("av-random").addEventListener("click", () => {
    av = randomAvatar();
    showAvatar();
});

for (const lang of LANGS) $("lang").add(new Option(lang, lang));
$("lang").value = LANGS.includes(store.get("lang")) ? store.get("lang") : "English";
$("lang").addEventListener("change", () => store.set("lang", $("lang").value));
$("name").value = store.get("name");
$("name").addEventListener("input", () => store.set("name", $("name").value.trim()));
// Someone signed in to the launcher gets their account name to start with.
if (!$("name").value) {
    import("../account.js")
        .then((m) => m.me())
        .then((r) => {
            const name = r?.me?.display ?? r?.me?.name;
            if (name && !$("name").value) {
                $("name").value = name.slice(0, 20);
                store.set("name", $("name").value);
            }
        })
        .catch(() => {});
}

function showInvite() {
    $("invite").hidden = !inviteCode;
    $("invite-code").textContent = inviteCode;
    $("create").hidden = Boolean(inviteCode);
    document.querySelector(".join-code").hidden = Boolean(inviteCode);
}
showInvite();
$("invite-cancel").addEventListener("click", (e) => {
    e.preventDefault();
    inviteCode = "";
    showInvite();
    setParentHash("");
});

function homeError(text) {
    $("home-err").textContent = text;
    $("home-err").hidden = !text;
}
function busy(on) {
    for (const id of ["play", "create", "join"]) $(id).disabled = on;
    $("play").textContent = on ? "Connecting…" : "Play!";
}

function sid() {
    let id = store.get("sid");
    if (!id) {
        id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
        store.set("sid", id);
    }
    return id;
}

function openSocket(url, ms = 6000) {
    return new Promise((resolve, reject) => {
        let ws;
        try {
            ws = new WebSocket(url);
        } catch (e) {
            return reject(e);
        }
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error("timed out"));
        }, ms);
        ws.onopen = () => {
            clearTimeout(timer);
            resolve(ws);
        };
        ws.onerror = ws.onclose = () => {
            clearTimeout(timer);
            reject(new Error("could not connect"));
        };
    });
}

async function enter(join) {
    const name = $("name").value.trim();
    if (!name) {
        homeError("Enter a name first.");
        $("name").focus();
        return;
    }
    homeError("");
    busy(true);
    G.left = false;
    let ws = null;
    for (const base of ROOMS_APIS) {
        try {
            ws = await openSocket(`${base.replace(/^http/, "ws")}/draw`);
            break;
        } catch {
            // try the next address
        }
    }
    if (!ws) {
        busy(false);
        homeError("Couldn't reach the game server. Check your connection and try again.");
        return;
    }
    G.ws = ws;
    ws.onmessage = (e) => {
        let msg;
        try {
            msg = JSON.parse(e.data);
        } catch {
            return;
        }
        handle(msg);
    };
    ws.onclose = () => {
        if (G.ws !== ws) return;
        G.ws = null;
        if (!G.left) goHome(G.kicked ?? "Lost the connection to the server.");
        G.kicked = null;
    };
    send({ t: "join", name, av, lang: $("lang").value, sid: sid(), ...join });
}
const send = (obj) => {
    if (G.ws?.readyState === WebSocket.OPEN) G.ws.send(JSON.stringify(obj));
};

$("play").addEventListener("click", () => enter(inviteCode ? { mode: "code", code: inviteCode } : { mode: "play" }));
$("create").addEventListener("click", () => enter({ mode: "create" }));
$("join").addEventListener("click", () => {
    const code = $("code").value.trim().toUpperCase();
    if (code.length < 4) return homeError("Type the room code first.");
    enter({ mode: "code", code });
});
$("code").addEventListener("keydown", (e) => e.key === "Enter" && $("join").click());
$("name").addEventListener("keydown", (e) => e.key === "Enter" && $("play").click());

function goHome(error = "") {
    G.left = true;
    G.ws?.close();
    G.ws = null;
    busy(false);
    $("game").hidden = true;
    $("home").hidden = false;
    homeError(error);
    setParentHash("");
    document.title = "doodle dash";
}
$("leave").addEventListener("click", () => goHome());

// The launcher's address carries the room, so the address bar is the invite.
function parentHash() {
    try {
        return parent !== window ? parent : null;
    } catch {
        return null;
    }
}
function setParentHash(code) {
    const top = parentHash();
    if (!top) return;
    try {
        top.history.replaceState(null, "", `#games/${GAME_ID}${code ? `/${code}` : ""}`);
    } catch {
        // not the same site: leave it
    }
}
function inviteUrl() {
    const top = parentHash();
    try {
        if (top) return `${top.location.origin}${top.location.pathname}#games/${GAME_ID}/${G.code}`;
    } catch {
        // cross-origin parent
    }
    return `${location.origin}${location.pathname}?room=${G.code}`;
}

// ---- the canvas

const cv = $("cv");
const ctx = cv.getContext("2d", { willReadFrequently: true });
let ops = [];
let tool = "pen";
let colour = "#000000";
let size = SIZES[1];
let current = null;
let sentUpTo = 0;
let flushTimer = 0;

function blank() {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
}
blank();

function drawStroke(op, from) {
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.strokeStyle = ctx.fillStyle = op.c;
    ctx.lineWidth = op.w;
    const p = op.p;
    if (p.length === 2) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], op.w / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    ctx.beginPath();
    ctx.moveTo(p[from], p[from + 1]);
    for (let i = from + 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
}

function floodFill(x, y, hex) {
    x = Math.min(W - 1, Math.max(0, x));
    y = Math.min(H - 1, Math.max(0, y));
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const fr = parseInt(hex.slice(1, 3), 16);
    const fg = parseInt(hex.slice(3, 5), 16);
    const fb = parseInt(hex.slice(5, 7), 16);
    const at = (y * W + x) * 4;
    const tr = d[at];
    const tg = d[at + 1];
    const tb = d[at + 2];
    if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 8) return;
    const seen = new Uint8Array(W * H);
    const ok = (px, py) => {
        const i = py * W + px;
        if (seen[i]) return false;
        const j = i * 4;
        return Math.abs(d[j] - tr) + Math.abs(d[j + 1] - tg) + Math.abs(d[j + 2] - tb) <= 90;
    };
    const stack = [[x, y]];
    while (stack.length) {
        const [sx, sy] = stack.pop();
        if (!ok(sx, sy)) continue;
        let l = sx;
        let r = sx;
        while (l > 0 && ok(l - 1, sy)) l--;
        while (r < W - 1 && ok(r + 1, sy)) r++;
        for (let px = l; px <= r; px++) {
            const i = sy * W + px;
            seen[i] = 1;
            d[i * 4] = fr;
            d[i * 4 + 1] = fg;
            d[i * 4 + 2] = fb;
            d[i * 4 + 3] = 255;
        }
        for (const ny of [sy - 1, sy + 1]) {
            if (ny < 0 || ny >= H) continue;
            let inside = false;
            for (let px = l; px <= r; px++) {
                if (ok(px, ny)) {
                    if (!inside) stack.push([px, ny]);
                    inside = true;
                } else inside = false;
            }
        }
    }
    ctx.putImageData(img, 0, 0);
}

function paintOp(op) {
    if (op.k === "s") drawStroke(op, 0);
    else if (op.k === "f") floodFill(op.x, op.y, op.c);
}
function redraw() {
    blank();
    for (const op of ops) paintOp(op);
}
function setOps(list) {
    ops = list.map((o) => ({ ...o, p: o.p ? [...o.p] : undefined }));
    redraw();
}

/** An op the drawer made, as the server relayed it. */
function applyRemote(o) {
    if (o.k === "s") {
        const op = { k: "s", c: o.c, w: o.w, p: [...o.p] };
        ops.push(op);
        drawStroke(op, 0);
    } else if (o.k === "m") {
        const last = ops[ops.length - 1];
        if (last?.k !== "s") return;
        const from = last.p.length - 2;
        last.p.push(...o.p);
        drawStroke(last, from);
    } else if (o.k === "f") {
        ops.push({ ...o });
        floodFill(o.x, o.y, o.c);
    } else if (o.k === "u") {
        ops.pop();
        redraw();
    } else if (o.k === "x") {
        ops = [];
        blank();
    }
}

const canDraw = () => G.phase === "draw" && G.drawer === G.me;
function point(e) {
    const r = cv.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) * W) / r.width), Math.round(((e.clientY - r.top) * H) / r.height)];
}
function flush() {
    flushTimer = 0;
    if (!current || current.p.length <= sentUpTo) return;
    send({ t: "d", o: { k: "m", p: current.p.slice(sentUpTo) } });
    sentUpTo = current.p.length;
}
cv.addEventListener("pointerdown", (e) => {
    if (!canDraw() || e.button > 0) return;
    e.preventDefault();
    const [x, y] = point(e);
    if (tool === "fill") {
        const op = { k: "f", x, y, c: colour };
        ops.push(op);
        paintOp(op);
        send({ t: "d", o: op });
        return;
    }
    cv.setPointerCapture(e.pointerId);
    current = { k: "s", c: tool === "eraser" ? "#ffffff" : colour, w: size, p: [x, y] };
    ops.push(current);
    drawStroke(current, 0);
    send({ t: "d", o: { ...current, p: [x, y] } });
    sentUpTo = 2;
});
cv.addEventListener("pointermove", (e) => {
    if (!current) return;
    const [x, y] = point(e);
    const n = current.p.length;
    if (Math.abs(x - current.p[n - 2]) + Math.abs(y - current.p[n - 1]) < 2) return;
    current.p.push(x, y);
    drawStroke(current, n - 2);
    flushTimer ||= setTimeout(flush, 40);
});
const stop = () => {
    clearTimeout(flushTimer);
    flush();
    current = null;
};
cv.addEventListener("pointerup", stop);
cv.addEventListener("pointercancel", stop);

function undo() {
    if (!canDraw() || ops.length === 0) return;
    ops.pop();
    redraw();
    send({ t: "d", o: { k: "u" } });
}
$("undo").addEventListener("click", undo);
$("clear").addEventListener("click", () => {
    if (!canDraw()) return;
    ops = [];
    blank();
    send({ t: "d", o: { k: "x" } });
});
addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.target.matches?.("input, textarea")) {
        e.preventDefault();
        undo();
    }
});

// toolbar
const palette = $("palette");
for (const c of COLOURS) {
    const b = el("button", { type: "button", title: c, ariaLabel: c });
    b.style.background = c;
    b.addEventListener("click", () => pickColour(c));
    palette.append(b);
}
function pickColour(c) {
    colour = c;
    if (tool === "eraser") tool = "pen";
    $("custom-colour").value = c;
    showTools();
}
$("custom-colour").addEventListener("input", (e) => pickColour(e.target.value));
for (const s of SIZES) {
    const b = el("button", { type: "button", title: `${s}`, ariaLabel: `brush size ${s}` });
    const dot = el("i");
    dot.style.width = dot.style.height = `${Math.max(4, Math.min(28, s * 0.5))}px`;
    b.append(dot);
    b.addEventListener("click", () => {
        size = s;
        showTools();
    });
    $("sizes").append(b);
}
for (const b of document.querySelectorAll("[data-tool]")) {
    b.addEventListener("click", () => {
        tool = b.dataset.tool;
        showTools();
    });
}
function showTools() {
    [...palette.children].forEach((b, i) => b.classList.toggle("on", COLOURS[i] === colour && tool !== "eraser"));
    [...$("sizes").children].forEach((b, i) => b.classList.toggle("on", SIZES[i] === size));
    for (const b of document.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool === tool);
    cv.classList.toggle("can", canDraw());
}
showTools();

// ---- players

const rankOf = (id) => 1 + G.players.filter((p) => p.score > (G.players.find((q) => q.id === id)?.score ?? 0)).length;
let openMenu = null;

function renderPlayers() {
    const list = $("plist");
    list.replaceChildren();
    for (const p of G.players) {
        const li = el("li", { className: `player${p.guessed ? " guessed" : ""}${p.id === G.me ? " me" : ""}${G.muted.has(p.id) ? " muted" : ""}` });
        const badges = `${p.host ? "👑" : ""}${p.drawing ? "✏️" : ""}`;
        const pav = el("span", { className: "pav" });
        pav.innerHTML = avatar(p.av);
        const who = el("span", { className: "who" }, el("b", { textContent: `${p.name}${p.id === G.me ? " (you)" : ""}` }), el("small", { textContent: `${p.score} points` }));
        li.append(el("span", { className: "rank", textContent: `#${rankOf(p.id)}` }), pav, who, el("span", { className: "badges", textContent: badges }));
        li.addEventListener("click", () => {
            if (p.id === G.me) return;
            openMenu = openMenu === p.id ? null : p.id;
            renderPlayers();
        });
        if (openMenu === p.id) li.append(menuFor(p));
        list.append(li);
    }
}
function menuFor(p) {
    const menu = el("div", { className: "pmenu" });
    const add = (label, fn, danger) => {
        const b = el("button", { type: "button", textContent: label, className: danger ? "danger" : "" });
        b.addEventListener("click", (e) => {
            e.stopPropagation();
            openMenu = null;
            fn();
            renderPlayers();
        });
        menu.append(b);
    };
    add(G.muted.has(p.id) ? "Unmute" : "Mute", () => (G.muted.has(p.id) ? G.muted.delete(p.id) : G.muted.add(p.id)));
    if (G.players.length >= 3) add("Vote kick", () => send({ t: "votekick", id: p.id }), true);
    if (G.host === G.me) {
        add("Kick", () => send({ t: "kick", id: p.id }), true);
        add("Ban", () => send({ t: "ban", id: p.id }), true);
    }
    return menu;
}

// ---- header

function renderWord() {
    const box = $("word");
    box.className = "word";
    box.replaceChildren();
    const label = $("wordlabel");
    const text = (t) => box.append(t);
    const inDraw = G.phase === "draw";
    if (G.phase === "lobby") {
        label.textContent = "";
        text("WAITING");
    } else if (G.phase === "choose") {
        label.textContent = "";
        text(G.drawer === G.me ? "CHOOSE A WORD" : "GET READY…");
    } else if (G.phase === "turnend") {
        label.textContent = "THE WORD WAS";
        text(G.turn?.word ?? "—");
    } else if (G.phase === "gameend") {
        label.textContent = "";
        text("GAME OVER");
    } else if (inDraw && G.drawer === G.me) {
        label.textContent = "DRAW THIS";
        text(G.word ?? "");
    } else if (inDraw && G.word) {
        label.textContent = "YOU GOT IT!";
        box.classList.add("known");
        text(G.word);
    } else if (inDraw && (G.hidden || G.mask === null)) {
        label.textContent = "GUESS THIS";
        text("? ? ?");
    } else if (inDraw) {
        label.textContent = "GUESS THIS";
        for (const ch of G.mask) {
            if (ch === "_") box.append(el("span", { className: "blank" }));
            else if (ch === " ") box.append(el("span", { className: "gap" }));
            else box.append(ch);
        }
        const count = [...G.mask].filter((ch) => /[\p{L}\p{N}_]/u.test(ch)).length;
        box.append(el("span", { className: "len", textContent: `(${count})` }));
    }
    $("roundinfo").textContent = G.rounds && G.phase !== "lobby" && G.phase !== "gameend" ? `Round ${G.round} of ${G.rounds}` : "";
}

let lastTick = -1;
function renderClock() {
    const clock = $("clock");
    let secs = Math.max(0, Math.ceil((G.endsAt - Date.now()) / 1000));
    if (G.phase === "lobby") secs = G.countdownEnd ? Math.max(0, Math.ceil((G.countdownEnd - Date.now()) / 1000)) : -1;
    clock.textContent = secs < 0 ? "⏳" : String(secs);
    clock.classList.toggle("low", G.phase === "draw" && secs <= 10);
    if (G.phase === "draw" && secs <= 10 && secs > 0 && secs !== lastTick) play("tick");
    lastTick = G.phase === "draw" ? secs : -1;
    // Overlay countdowns.
    if (G.phase === "gameend") $("end-note").textContent = `Back to the lobby in ${secs}…`;
    if (G.phase === "lobby" && !$("ov-lobby").hidden) {
        $("lobby-note").textContent = lobbyNote(secs);
    }
    if (G.phase === "choose" && G.drawer === G.me) $("choose-title").textContent = `Choose a word (${secs})`;
}
const lobbyNote = (secs) => {
    if (G.isPublic) {
        if (G.players.length < 2) return "Waiting for more players…";
        return G.countdownEnd ? `The game starts in ${Math.max(0, secs)}…` : "Starting…";
    }
    if (G.host === G.me) return G.players.length < 2 ? "Share the invite link: you need at least 2 players." : "Change the settings, then press Start.";
    return "Waiting for the host to start the game…";
};
setInterval(renderClock, 250);

// ---- overlays

const OVS = ["lobby", "choose", "turn", "end"];
function showOv(name) {
    $("ov").hidden = !name;
    // Roomy panels (settings, podium) get a taller stage than the canvas's own shape.
    $("canvaswrap").classList.toggle("tall", name === "lobby" || name === "end" || name === "turn");
    for (const o of OVS) $(`ov-${o}`).hidden = o !== name;
}
const nameOf = (id) => G.players.find((p) => p.id === id)?.name ?? "Someone";
const avOf = (id) => G.players.find((p) => p.id === id)?.av ?? [0, 0, 0, 0];

function renderOverlay() {
    if (G.phase !== "choose") $("choices").replaceChildren();
    $("votes").hidden = !(G.phase === "draw" && G.drawer !== G.me);
    if (G.phase === "lobby") {
        showOv("lobby");
        renderLobby();
    } else if (G.phase === "choose") {
        showOv("choose");
        const me = G.drawer === G.me;
        $("choose-av").hidden = me;
        $("choose-av").innerHTML = avatar(avOf(G.drawer));
        $("choose-title").textContent = me ? "Choose a word" : `${nameOf(G.drawer)} is choosing a word!`;
        const box = $("choices");
        box.replaceChildren();
        if (me) {
            (G.choices ?? []).forEach((w, i) => {
                const b = el("button", { type: "button", textContent: w });
                b.addEventListener("click", () => {
                    send({ t: "pick", i });
                    G.choices = null;
                });
                box.append(b);
            });
        }
    } else if (G.phase === "turnend" && G.turn) {
        showOv("turn");
        renderTurn();
    } else if (G.phase === "gameend") {
        showOv("end");
        renderEnd();
    } else showOv(null);
    renderTools();
}

function scoreRow(p, extra) {
    const li = el("li");
    const pav = el("span", { className: "pav" });
    pav.innerHTML = avatar(p.av);
    li.append(pav, el("span", { textContent: p.name }), extra);
    return li;
}
function renderTurn() {
    const t = G.turn;
    $("turn-word").textContent = t.word ?? "—";
    $("turn-reason").textContent = t.reason ? t.reason[0].toUpperCase() + t.reason.slice(1) : "";
    const rows = G.players
        .map((p) => ({ p, d: t.deltas?.[p.id] ?? 0 }))
        .sort((a, b) => b.d - a.d);
    $("turn-list").replaceChildren(...rows.map(({ p, d }) => scoreRow(p, el("span", { className: d > 0 ? "plus" : "zero", textContent: d > 0 ? `+${d}` : "+0" }))));
    $("turn-votes").textContent = t.votes && (t.votes.up || t.votes.down) ? `Drawing: 👍 ${t.votes.up}  👎 ${t.votes.down}` : "";
}
function renderEnd() {
    const r = G.ranking;
    const winners = r.filter((x) => x.rank === 1);
    $("end-title").textContent = winners.length === 1 ? `${winners[0].name} wins!` : winners.length > 1 ? "It's a tie!" : "Game over!";
    const podium = $("podium");
    podium.replaceChildren();
    for (const [index, cls] of [[1, "r2"], [0, "r1"], [2, "r3"]]) {
        const who = r[index];
        if (!who) continue;
        const step = el("div", { className: `step ${cls}` });
        const pav = el("span", { className: "pav" });
        pav.innerHTML = avatar(who.av);
        step.append(index === 0 ? el("span", { className: "crown", textContent: "👑" }) : "", pav, el("b", { textContent: who.name }), el("div", { className: "block", textContent: `${who.rank}` }), el("small", { textContent: `${who.score} points` }));
        podium.append(step);
    }
    $("end-list").replaceChildren(...r.slice(3).map((x) => scoreRow(x, el("span", { textContent: `#${x.rank} · ${x.score}` }))));
}

// the lobby's settings
const fill = (id, values, label = (v) => v) => {
    const sel = $(id);
    for (const v of values) sel.add(new Option(label(v), v));
};
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
fill("s-maxPlayers", range(2, 20));
fill("s-lang", LANGS);
fill("s-drawTime", [15, 30, 45, 60, 80, 90, 100, 120, 150, 180, 210, 240], (v) => `${v} s`);
fill("s-rounds", range(1, 10));
fill("s-wordCount", range(1, 5));
fill("s-hints", range(0, 5));
const SETTING_IDS = ["maxPlayers", "lang", "drawTime", "rounds", "wordCount", "hints", "mode"];
function sendSettings() {
    if (G.host !== G.me || G.isPublic) return;
    const s = {};
    for (const k of SETTING_IDS) s[k] = $(`s-${k}`).value;
    s.custom = $("s-custom").value;
    s.customOnly = $("s-customOnly").checked;
    send({ t: "settings", ...s });
}
let customTimer = 0;
for (const k of SETTING_IDS) $(`s-${k}`).addEventListener("change", sendSettings);
$("s-customOnly").addEventListener("change", sendSettings);
$("s-custom").addEventListener("input", () => {
    clearTimeout(customTimer);
    customTimer = setTimeout(sendSettings, 400);
});
function fillSettings() {
    const s = G.settings;
    if (!s) return;
    for (const k of SETTING_IDS) {
        const sel = $(`s-${k}`);
        if (document.activeElement !== sel) sel.value = String(s[k]);
    }
    if (document.activeElement !== $("s-custom")) $("s-custom").value = s.custom;
    $("s-customOnly").checked = s.customOnly;
    const editable = G.host === G.me && !G.isPublic;
    for (const k of [...SETTING_IDS, "custom", "customOnly"]) $(`s-${k}`).disabled = !editable;
}
function renderLobby() {
    fillSettings();
    const host = G.host === G.me && !G.isPublic;
    $("start").hidden = !host;
    $("start").disabled = G.players.length < 2;
    $("invite-copy").hidden = G.isPublic;
    $("invite-line").hidden = G.isPublic;
    $("invite-line").textContent = G.isPublic ? "" : `Room code: ${G.code}`;
    $("lobby-note").textContent = lobbyNote(Math.ceil((G.countdownEnd - Date.now()) / 1000));
}
$("start").addEventListener("click", () => send({ t: "start" }));
$("invite-copy").addEventListener("click", async () => {
    const url = inviteUrl();
    try {
        await navigator.clipboard.writeText(url);
        $("invite-copy").textContent = "Copied!";
    } catch {
        $("invite-line").textContent = url;
        $("invite-copy").textContent = "Copy it from below";
    }
    setTimeout(() => ($("invite-copy").textContent = "Copy invite link"), 1800);
});

function renderTools() {
    $("tools").hidden = !canDraw();
    showTools();
    const input = $("chat-input");
    const drawing = G.phase === "draw";
    const me = G.players.find((p) => p.id === G.me);
    input.placeholder = drawing && (G.drawer === G.me || me?.guessed) ? "Chat with the others who know the word…" : "Type your guess here…";
}

// ---- votes

for (const [id, v] of [["up", 1], ["down", -1]]) {
    $(id).addEventListener("click", () => {
        G.myVote = G.myVote === v ? 0 : v;
        send({ t: "vote", v });
        showVote();
    });
}
function showVote() {
    $("up").classList.toggle("on", G.myVote === 1);
    $("down").classList.toggle("on", G.myVote === -1);
}

// ---- chat

const msgs = $("msgs");
function addChat(kind, text, name = "", id = 0) {
    if ((kind === "msg" || kind === "private") && G.muted.has(id)) return;
    const near = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;
    const row = el("div", { className: `msg ${kind}` });
    if (name) row.append(el("b", { textContent: `${name}: ` }));
    row.append(text);
    msgs.append(row);
    while (msgs.children.length > 250) msgs.firstChild.remove();
    if (near) msgs.scrollTop = msgs.scrollHeight;
}
$("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("chat-input").value.trim();
    $("chat-input").value = "";
    if (text) send({ t: "chat", text });
});

// ---- server messages

function enterGame(m) {
    Object.assign(G, {
        me: m.you,
        code: m.code,
        isPublic: m.public,
        host: m.host,
        settings: m.settings,
        players: m.players,
        phase: m.phase,
        round: m.round,
        rounds: m.rounds,
        drawer: m.drawer,
        endsAt: Date.now() + m.ms,
        countdownEnd: m.countdown ? Date.now() + m.countdown : 0,
        mask: m.mask ?? null,
        hidden: m.hidden,
        word: null,
        choices: null,
        ranking: m.ranking ?? [],
        turn: m.lastTurn ?? null,
        muted: new Set(),
        myVote: 0,
    });
    msgs.replaceChildren();
    setOps(m.canvas ?? []);
    $("upn").textContent = m.votes?.up ?? 0;
    $("downn").textContent = m.votes?.down ?? 0;
    showVote();
    $("home").hidden = true;
    $("game").hidden = false;
    busy(false);
    document.title = `doodle dash · ${m.public ? "public room" : m.code}`;
    if (!m.public) setParentHash(m.code);
    addChat("sys", m.public ? "You joined a public room." : `You're in room ${m.code}.`);
    renderAll();
    $("chat-input").focus();
}
function renderAll() {
    renderPlayers();
    renderWord();
    renderOverlay();
    renderClock();
}

function handle(m) {
    switch (m.t) {
        case "joinfail":
            busy(false);
            homeError(m.msg);
            G.ws?.close();
            G.ws = null;
            return;
        case "room":
            return enterGame(m);
        case "players":
            G.players = m.players;
            renderPlayers();
            renderWord();
            if (G.phase === "lobby") renderLobby();
            return renderTools();
        case "settings":
            G.settings = m.settings;
            return fillSettings();
        case "host":
            G.host = m.id;
            renderPlayers();
            if (G.phase === "lobby") renderLobby();
            return;
        case "countdown":
            G.countdownEnd = m.ms ? Date.now() + m.ms : 0;
            return;
        case "lobby":
            G.phase = "lobby";
            G.players = m.players;
            G.drawer = null;
            G.word = null;
            G.round = 0;
            setOps([]);
            return renderAll();
        case "phase":
            G.phase = m.phase;
            G.drawer = m.drawer;
            G.round = m.round;
            G.rounds = m.rounds;
            G.endsAt = Date.now() + m.ms;
            G.hidden = Boolean(m.hidden);
            G.mask = m.mask ?? null;
            G.myVote = 0;
            showVote();
            if (m.phase === "choose") {
                G.word = null;
                G.choices = m.words ?? null;
            } else {
                G.word = m.word ?? null;
                if (G.drawer === G.me) addChat("sys", "It's your turn to draw!");
            }
            return renderAll();
        case "hint":
            G.mask = m.mask;
            play("hint");
            return renderWord();
        case "word":
            G.word = m.word;
            renderWord();
            return renderTools();
        case "turnend":
            G.phase = "turnend";
            G.turn = m;
            G.endsAt = Date.now() + m.ms;
            addChat("sys", m.word ? `The word was "${m.word}".` : "Nobody drew this turn.");
            return renderAll();
        case "gameend":
            G.phase = "gameend";
            G.ranking = m.ranking;
            G.endsAt = Date.now() + m.ms;
            return renderAll();
        case "d":
            return applyRemote(m.o);
        case "canvas":
            return setOps(m.ops);
        case "votes":
            $("upn").textContent = m.up;
            $("downn").textContent = m.down;
            return;
        case "chat":
            return addChat(m.kind, m.text, m.kind === "msg" || m.kind === "private" ? m.name : "", m.id);
        case "sound":
            return play(m.name);
        case "kicked":
            G.kicked = m.ban ? "You were banned from that room." : "You were kicked from that room.";
            return;
    }
}
