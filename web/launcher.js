// The launcher page: a home screen with "chat" and "minecraft". Chat iframes
// the chat site; minecraft lists the public rooms and has a Launch! button
// that opens the game (game.html). Settings live in config.js.
import { CHAT_URL, GAME_URL, ROOMS_API, REFRESH_MS } from "./config.js";
import { configured, publicRoomsOn, setPublicRooms, startPresence } from "./presence.js";

const $ = (id) => document.getElementById(id);
const views = { home: $("home"), chat: $("chat"), minecraft: $("minecraft") };
const chatFrame = $("chat-frame");
const body = $("rooms-body");
const empty = $("rooms-empty");
const note = $("rooms-note");
const onlineBadges = document.querySelectorAll(".online");
const publicToggle = $("public-toggle");
let timer = null;
let loading = 0; // newest request wins

$("launch").href = GAME_URL;

function showOnline(n) {
    for (const badge of onlineBadges) {
        badge.hidden = false;
        badge.querySelector("b").textContent = n;
    }
}
// Tells the service this tab is here and shows how many are.
startPresence(showOnline);

publicToggle.checked = publicRoomsOn();
publicToggle.addEventListener("change", () => setPublicRooms(publicToggle.checked));

// Starts the service worker early, so the game's first launch is already
// cross-origin isolated (it gives game.html the headers its threads need).
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

function show() {
    const name = location.hash.slice(1);
    const view = name in views ? name : "home";
    for (const [key, el] of Object.entries(views)) el.hidden = key !== view;
    // The chat loads when first opened, and stays loaded when you come back.
    if (view === "chat" && !chatFrame.src) chatFrame.src = CHAT_URL;
    clearInterval(timer);
    timer = null;
    if (view === "minecraft") {
        loadRooms();
        timer = setInterval(loadRooms, REFRESH_MS);
    }
}

function setEmpty(text, retry) {
    empty.textContent = text;
    if (retry) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ghost";
        button.textContent = "try again";
        button.addEventListener("click", loadRooms);
        empty.append(button);
    }
    empty.hidden = false;
}

function roomsOf(data) {
    const list = Array.isArray(data) ? data : data?.rooms;
    if (!Array.isArray(list)) throw new Error("unexpected response");
    return list.filter((r) => r && r.public !== false && r.code);
}

function players(room) {
    const n = Number(room.players ?? room.playerCount ?? 0) || 0;
    const max = Number(room.maxPlayers ?? room.max ?? 0) || 0;
    return max ? `${n} / ${max}` : String(n);
}

function copyButton(code) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost copy";
    button.textContent = "copy";
    button.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(code);
            button.textContent = "copied";
        } catch {
            button.textContent = "press ctrl+c";
        }
        setTimeout(() => (button.textContent = "copy"), 1500);
    });
    return button;
}

function render(rooms) {
    body.replaceChildren();
    for (const room of rooms) {
        const row = body.insertRow();
        const code = row.insertCell();
        code.className = "code";
        code.textContent = String(room.code);
        row.insertCell().textContent = String(room.owner ?? room.host ?? "unknown");
        const count = row.insertCell();
        count.className = "count";
        count.textContent = players(room);
        row.insertCell().append(copyButton(String(room.code)));
    }
    if (rooms.length) {
        empty.hidden = true;
    } else {
        setEmpty("no public rooms right now");
    }
    note.textContent = `${rooms.length} room${rooms.length === 1 ? "" : "s"} · updated ${new Date().toLocaleTimeString()}`;
}

async function loadRooms() {
    if (!configured()) {
        body.replaceChildren();
        note.textContent = "";
        setEmpty("the rooms service isn't set up yet (ROOMS_API in config.js).");
        return;
    }
    const mine = ++loading;
    note.textContent = "loading…";
    try {
        const response = await fetch(`${ROOMS_API}/api/rooms`, { headers: { Accept: "application/json" }, cache: "no-store" });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const data = await response.json();
        const rooms = roomsOf(data);
        if (mine === loading) {
            render(rooms);
            if (Number.isFinite(data.online)) showOnline(data.online);
        }
    } catch (e) {
        if (mine !== loading) return;
        console.warn(`launcher: could not load rooms: ${e}`);
        body.replaceChildren();
        note.textContent = "";
        setEmpty("couldn't load the room list.", true);
    }
}

$("refresh").addEventListener("click", loadRooms);
addEventListener("hashchange", show);
show();
