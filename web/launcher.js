// The launcher page: a sidebar with Play, Chat, Games, Apps and Settings.
// Play lists the public shared worlds and has the Launch! button that opens the
// game (game.html); chat iframes the chat site; games and apps list seraph's
// catalog (catalog.json) and open each one, loaded from where seraph is hosted;
// settings holds the memory limit and whether worlds are listed publicly.
// Addresses live in config.js, the player's choices in settings.js.
import { CHAT_URL, GAME_URL, REFRESH_MS, SERAPH_URL } from "./config.js";
import { configured, roomsFetch, startPresence } from "./presence.js";
import { RAM_CHOICES, debugOn, publicRoomsOn, ramMb, setDebug, setPublicRooms, setRamMb } from "./settings.js";

const $ = (id) => document.getElementById(id);
const pages = { play: $("play"), chat: $("chat"), browse: $("browse"), player: $("player"), settings: $("settings") };
const chatFrame = $("chat-frame");
const body = $("rooms-body");
const empty = $("rooms-empty");
const note = $("rooms-note");
const onlineBadges = document.querySelectorAll(".online");
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

// Starts the service worker early, so the game's first launch is already
// cross-origin isolated (it gives game.html the headers its threads need).
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// Routes: #play (also #minecraft), #chat, #games, #apps, #settings, and
// #games/<id> or #apps/<id> for one game or app playing.
function show() {
    const [name, id] = location.hash.slice(1).split("/");
    let page = "play";
    let nav = "play";
    if (name === "chat" || name === "settings") page = nav = name;
    else if (name === "games" || name === "apps") {
        page = id ? "player" : "browse";
        nav = name;
    }
    for (const [key, el] of Object.entries(pages)) el.hidden = key !== page;
    for (const link of document.querySelectorAll("[data-nav]")) link.classList.toggle("on", link.dataset.nav === nav);
    // The chat loads when first opened, and stays loaded when you come back.
    if (page === "chat" && !chatFrame.src) chatFrame.src = CHAT_URL;
    clearInterval(timer);
    timer = null;
    if (page === "play") {
        loadRooms();
        timer = setInterval(loadRooms, REFRESH_MS);
    }
    // Leaving a game unloads it, so its sound stops.
    if (page !== "player" && playerFrame.getAttribute("src") !== "about:blank") playerFrame.src = "about:blank";
    if (page === "browse") openBrowse(name);
    if (page === "player") openPlayer(name, decodeURIComponent(id));
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
        setEmpty("no public worlds right now");
    }
    note.textContent = `${rooms.length} room${rooms.length === 1 ? "" : "s"} · updated ${new Date().toLocaleTimeString()}`;
}

async function loadRooms() {
    if (!configured()) {
        body.replaceChildren();
        note.textContent = "";
        setEmpty("the rooms service isn't set up yet (ROOMS_APIS in config.js).");
        return;
    }
    const mine = ++loading;
    note.textContent = "loading…";
    try {
        const response = await roomsFetch("/api/rooms", { headers: { Accept: "application/json" }, cache: "no-store" });
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

// ---- settings

const segment = (id, get, set) => {
    const seg = $(id);
    const paint = () => {
        for (const button of seg.querySelectorAll("button")) button.classList.toggle("on", (button.dataset.value === "on") === get());
    };
    seg.addEventListener("click", (e) => {
        const button = e.target.closest("button");
        if (!button) return;
        set(button.dataset.value === "on");
        paint();
    });
    paint();
};
segment("public-seg", publicRoomsOn, setPublicRooms);
segment("debug-seg", debugOn, setDebug);

const ram = $("ram");
const gb = (mb) => (mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`);
for (const mb of RAM_CHOICES) ram.add(new Option(mb ? `Up to ${gb(mb)}` : "Automatic (up to 4 GB)", String(mb)));
// A value saved by hand that isn't a listed choice is still shown.
if (!RAM_CHOICES.includes(ramMb())) ram.add(new Option(`Up to ${gb(ramMb())}`, String(ramMb())));
ram.value = String(ramMb());
const device = navigator.deviceMemory ? ` This device reports about ${navigator.deviceMemory} GB of RAM.` : "";
$("ram-hint").textContent =
    "The most the game may use. A lower limit helps on devices with little memory (a black screen right after loading is often that), but too low and the game can run out. Takes effect the next time the game starts." + device;
ram.addEventListener("change", () => setRamMb(Number(ram.value)));

for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => {
        for (const other of document.querySelectorAll(".tab")) {
            other.classList.toggle("on", other === tab);
            $(`tab-${other.dataset.tab}`).hidden = other !== tab;
        }
    });
}
$("about-device").textContent =
    `This browser: ${navigator.gpu ? "WebGPU available" : "no WebGPU"}, ${navigator.hardwareConcurrency ?? "?"} CPU threads` +
    (navigator.deviceMemory ? `, about ${navigator.deviceMemory} GB RAM` : "") + ".";

$("refresh").addEventListener("click", loadRooms);
addEventListener("hashchange", show);
show();
