// The launcher page: a sidebar with Play, Chat, Games, Apps and Settings.
// Play lists the public shared worlds and has the Launch! button that opens the
// game (game.html); chat iframes the chat site; games and apps list seraph's
// catalog (catalog.json) and open each one, loaded from where seraph is hosted;
// settings holds the memory limit and whether worlds are listed publicly.
// Addresses live in config.js, the player's choices in settings.js.
import { CHAT_URL, GAME_URL, NEW_GAME_URL, REFRESH_MS, SERAPH_URL } from "./config.js";
import { configured, publicRoomsOn, roomsFetch, setPublicRooms, startPresence } from "./presence.js";
import {
    RAM_CHOICES, client, clearSettings, customRelays, debugOn, fullscreenOn, ramMb, setCustomRelays, setDebug, setFullscreen,
    setClient, setRamMb, setTheme, theme,
} from "./settings.js";
import { RELAY_URLS } from "./config.js";
import * as packs from "./packs.js";
import * as servers from "./servers.js";

const $ = (id) => document.getElementById(id);
const pages = { play: $("play"), chat: $("chat"), browse: $("browse"), player: $("player"), settings: $("settings"), packs: $("packs"), servers: $("servers") };
const chatFrame = $("chat-frame");
const body = $("rooms-body");
const empty = $("rooms-empty");
const note = $("rooms-note");
const onlineBadges = document.querySelectorAll(".online");
let timer = null;
let loading = 0; // newest request wins

// Which game page Launch! opens: the classic one, or the new one chosen in settings.
const newClient = () => Boolean(NEW_GAME_URL) && client() === "new";
const launchTarget = () => (newClient() ? NEW_GAME_URL : GAME_URL);
$("launch").href = launchTarget();

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
    if (name === "chat" || name === "settings" || name === "packs" || name === "servers") page = nav = name;
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
    if (page === "packs") renderPacks();
    if (page === "servers") renderServers();
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

// ---- servers

const serverList = $("server-list");
const serverError = $("server-error");
let serverRun = 0; // newest refresh wins

function serverRow(server, index) {
    const li = document.createElement("li");
    li.className = "server";
    const icon = document.createElement("div");
    icon.className = "icon";
    icon.textContent = (server.name[0] ?? "?").toUpperCase();
    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("b");
    name.textContent = server.name;
    const motd = document.createElement("span");
    motd.className = "motd";
    const motd2 = document.createElement("span");
    motd2.className = "motd2";
    const stat = document.createElement("span");
    stat.className = "stat";
    const dot = document.createElement("i");
    const detail = document.createElement("span");
    detail.textContent = `${server.address} · checking…`;
    stat.append(dot, detail);
    meta.append(name, motd, motd2, stat);
    const join = document.createElement("a");
    join.className = "join";
    join.textContent = "Join";
    // The new client has no way to be told a server to join: it opens on its own menus.
    join.href = newClient() ? NEW_GAME_URL : servers.joinUrl(GAME_URL, server.address);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "x";
    remove.title = "remove";
    remove.setAttribute("aria-label", `remove ${server.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
        servers.save(servers.load().filter((_, at) => at !== index));
        renderServers();
    });
    li.append(icon, meta, join, remove);
    return { li, motd, motd2, dot, detail };
}

function renderServers() {
    const list = servers.load();
    const run = ++serverRun;
    serverList.replaceChildren();
    $("server-empty").textContent = list.length ? "" : "No servers yet: add one below.";
    list.forEach((server, index) => {
        const row = serverRow(server, index);
        serverList.append(row.li);
        servers.query(server.address).then(
            (status) => {
                if (run !== serverRun) return;
                row.dot.className = "up";
                row.motd.textContent = status.motd[0] ?? "";
                row.motd2.textContent = status.motd[1] ?? "";
                const players = status.max ? `${status.online}/${status.max} online` : `${status.online} online`;
                row.detail.textContent = `${server.address} · ${status.ping} ms · ${players}`;
            },
            (e) => {
                if (run !== serverRun) return;
                row.dot.className = "down";
                row.detail.textContent = `${server.address} · ${e.message}`;
            },
        );
    });
}
$("server-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const address = servers.normalize($("server-address").value);
    if (!address) {
        serverError.textContent = "An address is host or host:port, or a wss:// address for an Eaglercraft server.";
        serverError.hidden = false;
        return;
    }
    serverError.hidden = true;
    const list = servers.load();
    if (list.some((s) => s.address.toLowerCase() === address.toLowerCase())) {
        serverError.textContent = "That server is already in the list.";
        serverError.hidden = false;
        return;
    }
    list.push({ name: $("server-name").value.trim() || address, address });
    servers.save(list);
    $("server-name").value = $("server-address").value = "";
    renderServers();
});
// Status goes stale: ask again while the page is open.
setInterval(() => {
    if (!pages.servers.hidden) renderServers();
}, 30000);

// ---- packs

const PACK_TEXT = {
    resource: {
        intro: "Resource packs (.zip). Turn them on, and order them, in the game: Options, Resource Packs.",
        empty: "No resource packs yet.",
    },
    shader: {
        intro: "Shader packs for WebGPU (.hshader). Pick one in the game: Options, Video Settings, Shader Packs.",
        empty: "No shader packs yet.",
    },
    mod: {
        intro: "Content mods (.hmod: blocks, items and data, no code). They start off: turn each on in the game's Mods screen. Mods that need compiling (.hnmod) can't run in a browser.",
        empty: "No mods yet.",
    },
};
let packKind = "resource";
const packMsg = $("pack-msg");
const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function packNote(text, bad) {
    packMsg.textContent = text;
    packMsg.classList.toggle("err", Boolean(bad));
    packMsg.hidden = !text;
}

async function renderPacks() {
    const kind = packKind;
    $("pack-intro").textContent = PACK_TEXT[kind].intro;
    $("pack-input").accept = packs.KINDS[kind].ext;
    const listEl = $("pack-list");
    if (!packs.supported()) {
        listEl.replaceChildren();
        $("pack-empty").textContent = "This browser can't keep files for the game (no private file system), so packs can't be added here.";
        $("pack-drop").hidden = true;
        return;
    }
    $("pack-drop").hidden = false;
    let files;
    try {
        files = await packs.list(kind);
    } catch (e) {
        packNote(`Couldn't read the packs: ${e.message}`, true);
        return;
    }
    if (kind !== packKind) return; // switched tabs meanwhile
    listEl.replaceChildren(...files.map((file) => {
        const li = document.createElement("li");
        const info = document.createElement("div");
        info.className = "info";
        const title = document.createElement("b");
        title.textContent = file.name;
        info.append(title);
        const size = document.createElement("span");
        size.className = "size";
        size.textContent = sizeText(file.size);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ghost";
        button.textContent = "Remove";
        button.addEventListener("click", async () => {
            try {
                await packs.remove(kind, file.name);
            } catch (e) {
                packNote(`Couldn't remove ${file.name}: ${e.message}`, true);
            }
            renderPacks();
        });
        li.append(info, size, button);
        return li;
    }));
    $("pack-empty").textContent = files.length ? "" : PACK_TEXT[kind].empty;
}

async function addPacks(files) {
    const { added, problems } = await packs.add(packKind, [...files]);
    const parts = [];
    if (added.length) parts.push(`Added ${added.join(", ")}. It's found the next time the game starts.`);
    parts.push(...problems);
    packNote(parts.join(" "), problems.length > 0 && added.length === 0);
    renderPacks();
}

for (const tab of document.querySelectorAll("[data-pack]")) {
    tab.addEventListener("click", () => {
        packKind = tab.dataset.pack;
        for (const other of document.querySelectorAll("[data-pack]")) other.classList.toggle("on", other === tab);
        packNote("");
        renderPacks();
    });
}
$("pack-add").addEventListener("click", () => $("pack-input").click());
$("pack-input").addEventListener("change", (e) => {
    addPacks(e.target.files);
    e.target.value = "";
});
const drop = $("pack-drop");
for (const type of ["dragenter", "dragover"]) {
    drop.addEventListener(type, (e) => {
        e.preventDefault();
        drop.classList.add("over");
    });
}
for (const type of ["dragleave", "drop"]) drop.addEventListener(type, () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
    e.preventDefault();
    addPacks(e.dataTransfer.files);
});

// ---- settings

// A row of buttons, one lit: get() is the current value, set(value) saves a click.
const segment = (id, get, set) => {
    const seg = $(id);
    const paint = () => {
        for (const button of seg.querySelectorAll("button")) button.classList.toggle("on", button.dataset.value === get());
    };
    seg.addEventListener("click", (e) => {
        const button = e.target.closest("button");
        if (!button) return;
        set(button.dataset.value);
        paint();
    });
    paint();
};
const onOff = (on) => (on ? "on" : "off");
segment("public-seg", () => onOff(publicRoomsOn()), (v) => setPublicRooms(v === "on"));
segment("debug-seg", () => onOff(debugOn()), (v) => setDebug(v === "on"));
if (!NEW_GAME_URL) $("client-row").hidden = true;
segment("client-seg", client, (v) => {
    setClient(v);
    $("launch").href = launchTarget();
    renderServers();
});
segment("fs-seg", () => onOff(fullscreenOn()), (v) => setFullscreen(v === "on"));

// Theme: "system" follows the device; the page always carries the one in use.
const dark = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => {
    document.documentElement.dataset.theme = theme() === "system" ? (dark.matches ? "dark" : "light") : theme();
};
applyTheme();
dark.addEventListener("change", applyTheme);
segment("theme-seg", theme, (v) => {
    setTheme(v);
    applyTheme();
});

// Full screen on the first tap or key press, once per page load.
if (fullscreenOn()) {
    const enter = () => {
        removeEventListener("pointerdown", enter, true);
        removeEventListener("keydown", enter, true);
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    };
    addEventListener("pointerdown", enter, true);
    addEventListener("keydown", enter, true);
}

// Relays: ours is built in (and in use unless the player added others, which go first).
const relayList = $("relay-list");
const relayError = $("relay-error");
function renderRelays() {
    relayList.replaceChildren();
    const row = (name, url, remove) => {
        const li = document.createElement("li");
        const info = document.createElement("div");
        info.className = "info";
        const title = document.createElement("b");
        title.textContent = name;
        const address = document.createElement("small");
        address.textContent = url;
        info.append(title, address);
        li.append(info);
        if (remove) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "ghost";
            button.textContent = "Remove";
            button.addEventListener("click", remove);
            li.append(button);
        } else {
            const tag = document.createElement("span");
            tag.className = "tag";
            tag.textContent = "Built in";
            li.append(tag);
        }
        relayList.append(li);
    };
    customRelays().forEach((relay, i) => {
        row(relay.name, relay.url, () => {
            setCustomRelays(customRelays().filter((_, at) => at !== i));
            renderRelays();
        });
    });
    if (RELAY_URLS[0]) row("z's horizon", RELAY_URLS[0], null);
}
$("relay-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const url = $("relay-url").value.trim();
    const name = $("relay-name").value.trim() || url;
    if (!/^wss?:\/\/[^\s/]+/.test(url)) {
        relayError.textContent = "An address starts with wss:// (or ws://) and a host.";
        relayError.hidden = false;
        return;
    }
    relayError.hidden = true;
    setCustomRelays([...customRelays(), { name, url }]);
    $("relay-name").value = $("relay-url").value = "";
    renderRelays();
});
renderRelays();

$("clear-data").addEventListener("click", () => {
    if (!confirm("Clear the launcher's settings and added relays? Your worlds are not deleted.")) return;
    clearSettings();
    location.reload();
});

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

for (const tab of document.querySelectorAll(".tab[data-tab]")) {
    tab.addEventListener("click", () => {
        for (const other of document.querySelectorAll(".tab[data-tab]")) {
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
