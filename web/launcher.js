// The launcher page: a home screen with "chat", "minecraft", "games" and "apps".
// Chat iframes the chat site; minecraft lists the public rooms and has a Launch!
// button that opens the game (game.html); games and apps list seraph's catalog
// (catalog.json) and open each one, loaded from where seraph is hosted.
// Settings live in config.js.
import { CHAT_URL, GAME_URL, ROOMS_API, REFRESH_MS, SERAPH_URL } from "./config.js";
import { configured, publicRoomsOn, setPublicRooms, startPresence } from "./presence.js";

const $ = (id) => document.getElementById(id);
const views = { home: $("home"), chat: $("chat"), minecraft: $("minecraft"), browse: $("browse"), player: $("player") };
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

// Routes: #chat, #minecraft, #games, #apps, and #games/<id> or #apps/<id> for
// one game or app playing.
function show() {
    const [name, id] = location.hash.slice(1).split("/");
    let view = "home";
    if (name === "chat" || name === "minecraft") view = name;
    else if (name === "games" || name === "apps") view = id ? "player" : "browse";
    for (const [key, el] of Object.entries(views)) el.hidden = key !== view;
    // The chat loads when first opened, and stays loaded when you come back.
    if (view === "chat" && !chatFrame.src) chatFrame.src = CHAT_URL;
    clearInterval(timer);
    timer = null;
    if (view === "minecraft") {
        loadRooms();
        timer = setInterval(loadRooms, REFRESH_MS);
    }
    // Leaving a game unloads it, so its sound stops.
    if (view !== "player" && playerFrame.getAttribute("src") !== "about:blank") playerFrame.src = "about:blank";
    if (view === "browse") openBrowse(name);
    if (view === "player") openPlayer(name, decodeURIComponent(id));
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

// ---- games and apps (seraph)

const grid = $("grid");
const browseEmpty = $("browse-empty");
const browseNote = $("browse-note");
const search = $("search");
const genre = $("genre");
const playerFrame = $("player-frame");
let catalog = null;
let catalogLoading = null;
let kind = "games";

// Where seraph is hosted, with a trailing slash; empty when not set up.
const seraph = (() => {
    try {
        const url = new URL(SERAPH_URL);
        return /^https?:$/.test(url.protocol) ? url.href.replace(/\/?$/, "/") : "";
    } catch {
        return "";
    }
})();

function loadCatalog() {
    catalogLoading ??= fetch("catalog.json")
        .then((r) => {
            if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
            return r.json();
        })
        .then((data) => (catalog = data));
    return catalogLoading;
}

function message(text, retry) {
    grid.replaceChildren();
    browseNote.textContent = "";
    browseEmpty.textContent = text;
    if (retry) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ghost";
        button.textContent = "try again";
        button.addEventListener("click", () => {
            catalogLoading = null;
            openBrowse(kind);
        });
        browseEmpty.append(button);
    }
    browseEmpty.hidden = false;
}

function card(item) {
    const link = document.createElement("a");
    link.className = "card";
    link.href = `#${kind}/${encodeURIComponent(item.id)}`;
    const image = document.createElement("img");
    image.loading = "lazy";
    image.alt = "";
    image.src = new URL(item.thumb, seraph).href;
    const name = document.createElement("b");
    name.textContent = item.name;
    link.append(image, name);
    if (item.desc) {
        const desc = document.createElement("small");
        desc.textContent = item.desc;
        link.append(desc);
    }
    return link;
}

function renderGrid() {
    if (!catalog) return;
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const items = catalog[kind].filter(
        (item) =>
            (genre.value === "all" || kind !== "games" || item.genre === genre.value) &&
            words.every((w) => item.name.toLowerCase().includes(w) || (item.desc ?? "").toLowerCase().includes(w)),
    );
    grid.className = kind === "apps" ? "grid apps" : "grid";
    grid.replaceChildren(...items.map(card));
    browseEmpty.textContent = "nothing matches that";
    browseEmpty.hidden = items.length > 0;
    browseNote.textContent = `${items.length} ${kind === "apps" ? "app" : "game"}${items.length === 1 ? "" : "s"}`;
}

async function openBrowse(which) {
    if (which !== kind) {
        kind = which;
        search.value = "";
        genre.value = "all";
    }
    $("browse-title").textContent = kind;
    search.placeholder = `search ${kind}`;
    genre.hidden = kind !== "games";
    if (!seraph) {
        message("seraph isn't set up yet: set SERAPH_URL in config.js to where it is hosted.");
        return;
    }
    try {
        await loadCatalog();
    } catch (e) {
        console.warn(`launcher: could not load catalog.json: ${e}`);
        message(`couldn't load the ${kind} list.`, true);
        return;
    }
    if (kind !== which) return; // moved on while it loaded
    if (genre.options.length === 0) {
        const genres = [...new Set(catalog.games.map((g) => g.genre))].sort();
        for (const value of ["all", ...genres]) genre.add(new Option(value === "other" ? "other" : value, value));
    }
    renderGrid();
}

async function openPlayer(which, id) {
    $("player-back").href = `#${which}`;
    if (!seraph) {
        location.hash = `#${which}`;
        return;
    }
    try {
        await loadCatalog();
    } catch {
        location.hash = `#${which}`;
        return;
    }
    const item = catalog[which].find((i) => i.id === id);
    // Only if still on this game.
    if (location.hash.slice(1).split("/")[0] !== which || decodeURIComponent(location.hash.split("/")[1] ?? "") !== id) return;
    if (!item) {
        location.hash = `#${which}`;
        return;
    }
    const url = new URL(item.path, seraph).href;
    $("player-title").textContent = item.name;
    $("player-tab").href = url;
    if (playerFrame.src !== url) playerFrame.src = url;
}

search.addEventListener("input", renderGrid);
genre.addEventListener("change", renderGrid);

$("refresh").addEventListener("click", loadRooms);
addEventListener("hashchange", show);
show();
