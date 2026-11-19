// The launcher page: a sidebar with Play, Chat, Games, Apps and Settings.
// Play lists the public shared worlds and has the Launch! button that opens the
// game (game.html); chat iframes the chat site; games and apps list seraph's
// catalog (catalog.json) and open each one, loaded from where seraph is hosted;
// settings holds the memory limit and whether worlds are listed publicly.
// Addresses live in config.js, the player's choices in settings.js.
import { CHAT_URL, GAME_URL, NEW_GAME_URL, REFRESH_MS, SERAPH_URL } from "./config.js";
import { configured, publicRoomsOn, refreshSite, roomsFetch, setPublicRooms, startPresence } from "./presence.js";
import * as account from "./account.js";
import { nametag, richText, showNotice } from "./notice.js";
import { MESSAGES, blockedReason, markSeen, takeFlash, watchSite } from "./site.js";
import {
    RAM_CHOICES, client, lowMemory, setLowMemory, setWispUrl, validWisp, wispUrl, clearSettings, customRelays, debugOn, fullscreenOn, ramMb, setCustomRelays, setDebug, setFullscreen,
    setClient, setRamMb, rawMouse, setRawMouse, setSpikeFilter, spikeFilter, setTheme, theme,
} from "./settings.js";
import { RELAY_URLS } from "./config.js";
import * as packs from "./packs.js";
import * as profile from "./profile.js";
import * as servers from "./servers.js";
import * as instances from "./instances.js";
import { Wisp } from "./wisp.js";

const $ = (id) => document.getElementById(id);
const pages = { play: $("play"), chat: $("chat"), browse: $("browse"), player: $("player"), settings: $("settings"), packs: $("packs"), servers: $("servers"), profile: $("profile"), instances: $("instances"), mods: $("mods"), account: $("account"), staff: $("staff") };
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
    if (name === "chat" || name === "settings" || name === "packs" || name === "servers" || name === "profile" || name === "instances" || name === "mods" || name === "account" || name === "staff") page = nav = name;
    else if (name === "games" || name === "apps") {
        page = id ? "player" : "browse";
        nav = name;
    }
    // "Quit game" returns here, to the page the game was started from.
    try {
        sessionStorage.setItem("horizon-return", location.pathname.split("/").pop() + location.search + location.hash);
    } catch {}
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
    if (page === "staff") globalThis.renderStaff?.();
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
        const actions = row.insertCell();
        const join = document.createElement("a");
        join.className = "ghost join-room";
        join.textContent = "join";
        join.href = servers.joinUrl(GAME_URL, `shared:${room.code}`);
        actions.append(join, copyButton(String(room.code)));
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
    detail.textContent = `${server.address}${server.java ? " (Java)" : ""} · checking…`;
    stat.append(dot, detail);
    meta.append(name, motd, motd2, stat);
    const join = document.createElement("a");
    join.className = "join";
    join.textContent = "Join";
    // The new client has no way to be told a server to join: it opens on its own menus.
    join.href = newClient() ? NEW_GAME_URL : servers.joinUrl(GAME_URL, server.address, server.java ? wispUrl() : "");
    if (server.java && !validWisp(wispUrl())) join.addEventListener("click", (e) => {
        e.preventDefault();
        $("wisp-note").textContent = "Add a Wisp server first: Java servers are reached through one.";
    });
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
        const wisp = server.java && validWisp(wispUrl()) ? new Wisp(wispUrl()) : null;
        const impl = wisp ? function () { const { host, port } = servers.hostPort(server.address); return wisp.connect(host, port); } : undefined;
        if (server.java && !wisp) {
            row.dot.className = "down";
            row.detail.textContent = `${server.address} (Java) · add a Wisp server to check it`;
            return;
        }
        servers.query(server.address, impl).then(
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
    list.push({ name: $("server-name").value.trim() || address, address, java: $("server-java").checked });
    servers.save(list);
    $("server-name").value = $("server-address").value = "";
    $("server-java").checked = false;
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
segment("lowmem-seg", () => onOff(lowMemory()), (v) => setLowMemory(v === "on"));
segment("raw-seg", () => onOff(rawMouse()), (v) => setRawMouse(v === "on"));
segment("spike-seg", spikeFilter, setSpikeFilter);
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

$("code-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("code-input").value.trim();
    if (!/^[A-Za-z0-9]{1,31}$/.test(code)) {
        $("code-input").setCustomValidity("A join code is letters and digits.");
        $("code-input").reportValidity();
        return;
    }
    location.href = servers.joinUrl(GAME_URL, `shared:${code}`);
});
$("code-input").addEventListener("input", () => $("code-input").setCustomValidity(""));
$("refresh").addEventListener("click", loadRooms);
addEventListener("hashchange", show);
show();

// ---- Profile: name, skin and cape, written for the game to read at start ----
{
    const nameEl = $("profile-name");
    const skinEl = $("profile-skin");
    const status = $("profile-status");
    const face = $("profile-face");
    let state = null;
    const say = (text) => (status.textContent = text);

    async function drawFace() {
        const file = state.skin === "custom" ? state.skinFile : null;
        face.hidden = !file;
        if (!file) return;
        const bitmap = await createImageBitmap(file);
        const ctx = face.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, 64, 64);
        ctx.drawImage(bitmap, 8, 8, 8, 8, 0, 0, 64, 64); // the face
        ctx.drawImage(bitmap, 40, 8, 8, 8, 0, 0, 64, 64); // the hat layer
        bitmap.close();
    }

    function paint() {
        skinEl.value = state.skin;
        $("profile-skin-remove").hidden = !state.skinFile;
        $("profile-cape-remove").hidden = !state.capeFile;
        for (const b of $("profile-arms").children) b.classList.toggle("on", (b.dataset.value === "slim") === state.slim);
        for (const b of $("profile-cape").children) {
            b.classList.toggle("on", (b.dataset.value === "on") === state.cape);
            b.disabled = b.dataset.value === "on" && !state.capeFile;
        }
        drawFace().catch(() => {});
    }

    async function persist(message = "Saved. It applies the next time the game starts.") {
        const name = nameEl.value.trim();
        if (name && !profile.validName(name)) return say("A name is 1 to 16 characters, with no spaces.");
        try {
            // No name chosen: keep the one the game made, by not writing a profile yet.
            if (name) await profile.save({ ...state, name });
            else if (state.name) await profile.save({ ...state, name: state.name });
            say(name || state.name ? message : "Pick a name to save your skin and cape.");
            if (name) state.name = name;
        } catch (e) {
            say(String(e.message ?? e));
        }
    }

    async function init() {
        if (!profile.supported()) {
            $("profile-unsupported").hidden = false;
            for (const el of pages.profile.querySelectorAll("input, select, button")) el.disabled = true;
            return;
        }
        skinEl.replaceChildren(
            ...profile.CHARACTERS.map((c) => new Option(c[0].toUpperCase() + c.slice(1), c)),
            new Option("Custom (uploaded)", "custom"),
        );
        state = await profile.load();
        nameEl.value = state.name;
        paint();
    }

    nameEl.addEventListener("change", () => persist());
    skinEl.addEventListener("change", () => {
        if (skinEl.value === "custom" && !state.skinFile) {
            skinEl.value = state.skin;
            return say("Upload a skin first.");
        }
        state.skin = skinEl.value;
        paint();
        persist();
    });
    $("profile-arms").addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        state.slim = b.dataset.value === "slim";
        paint();
        persist();
    });
    $("profile-cape").addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b || b.disabled) return;
        state.cape = b.dataset.value === "on";
        paint();
        persist();
    });
    for (const [id, importer, key, use] of [
        ["profile-skin-file", profile.importSkin, "skinFile", (s) => (s.skin = "custom")],
        ["profile-cape-file", profile.importCape, "capeFile", (s) => (s.cape = true)],
    ]) {
        $(id).addEventListener("change", async (e) => {
            const file = e.target.files[0];
            e.target.value = "";
            if (!file) return;
            try {
                await importer(file);
                state = { ...state, ...(await profile.load()) , name: state.name };
                use(state);
                paint();
                await persist();
            } catch (err) {
                say(String(err.message ?? err));
            }
        });
    }
    for (const [id, remove, key, reset] of [
        ["profile-skin-remove", profile.removeSkin, "skinFile", (s) => (s.skin = "steve")],
        ["profile-cape-remove", profile.removeCape, "capeFile", (s) => (s.cape = false)],
    ]) {
        $(id).addEventListener("click", async () => {
            await remove();
            state[key] = null;
            reset(state);
            paint();
            persist("Removed.");
        });
    }
    init().catch((e) => say(`Couldn't read your profile: ${e.message ?? e}`));
}

// ---- Wisp server for Java servers
{
    const input = $("wisp-url");
    const note = $("wisp-note");
    input.value = wispUrl();
    $("wisp-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const url = input.value.trim();
        if (url && !validWisp(url)) {
            note.textContent = "A Wisp server address starts with ws:// or wss://.";
            return;
        }
        setWispUrl(url);
        note.textContent = url ? "Saved." : "Removed.";
        renderServers();
    });
}

// ---- Instances
{
    const listEl = $("instance-list");
    const note = $("instance-note");
    const say = (text) => (note.textContent = text);
    for (const el of document.querySelectorAll(".instance-name")) el.textContent = instances.active().name;

    function render() {
        listEl.replaceChildren(
            ...instances.list().map((inst) => {
                const li = document.createElement("li");
                li.className = "server";
                const meta = document.createElement("div");
                meta.className = "meta";
                const name = document.createElement("strong");
                name.textContent = inst.name;
                const sub = document.createElement("span");
                sub.className = "hint";
                sub.textContent = inst.id === instances.activeId() ? "Active" : inst.id === instances.DEFAULT ? "The folder the game always used" : "";
                meta.append(name, sub);
                li.append(meta);
                const add = (label, handler, cls = "ghost") => {
                    const b = document.createElement("button");
                    b.type = "button";
                    b.className = cls;
                    b.textContent = label;
                    b.addEventListener("click", handler);
                    li.append(b);
                };
                if (inst.id !== instances.activeId()) {
                    add("Use", () => {
                        instances.setActive(inst.id);
                        location.reload(); // Profile and Packs read the new folder.
                    });
                }
                if (inst.id !== instances.DEFAULT) {
                    add("Rename", () => {
                        const next = prompt("Instance name", inst.name);
                        if (next === null) return;
                        try {
                            instances.rename(inst.id, next);
                            location.reload();
                        } catch (e) {
                            say(e.message);
                        }
                    });
                    add("Delete", async () => {
                        if (!confirm(`Delete "${inst.name}" and all its worlds? This can't be undone.`)) return;
                        try {
                            await instances.remove(inst.id);
                            location.reload();
                        } catch (e) {
                            say(String(e.message ?? e));
                        }
                    }, "x");
                }
                return li;
            }),
        );
    }

    $("instance-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!instances.supported()) return say("This browser can't keep files for the game, so instances can't be made here.");
        try {
            say("Creating…");
            const made = await instances.create($("instance-name").value, $("instance-copy").checked ? instances.activeId() : null);
            instances.setActive(made.id);
            location.reload();
        } catch (err) {
            say(String(err.message ?? err));
        }
    });
    render();
}

// ---- Mods: the community library's native mods, with a list kept per instance
{
    const MODS_URL = "./mods-library.json";
    const listEl = $("mod-list");
    const note = $("mod-note");
    const wantedKey = () => `horizon-mods-wanted-${instances.activeId()}`;
    const wanted = () => {
        try {
            return new Set(JSON.parse(localStorage.getItem(wantedKey()) ?? "[]"));
        } catch {
            return new Set();
        }
    };
    const saveWanted = (set) => {
        try {
            localStorage.setItem(wantedKey(), JSON.stringify([...set]));
        } catch {
            // Not remembered.
        }
    };
    let library = null;

    function render() {
        if (!library) return;
        const text = $("mod-search").value.trim().toLowerCase();
        const group = $("mod-group").value;
        const mine = wanted();
        const shown = library.mods.filter((m) =>
            (!group || m.group === group) && (!text || `${m.name} ${m.about} ${m.from} ${m.slug}`.toLowerCase().includes(text)));
        $("mod-count").textContent = `${shown.length} of ${library.mods.length} · ${mine.size} in your list`;
        listEl.replaceChildren(
            ...shown.map((m) => {
                const li = document.createElement("li");
                li.className = "server";
                const check = document.createElement("input");
                check.type = "checkbox";
                check.checked = mine.has(m.slug);
                check.setAttribute("aria-label", `keep ${m.name} in my list`);
                check.addEventListener("change", () => {
                    const set = wanted();
                    if (check.checked) set.add(m.slug);
                    else set.delete(m.slug);
                    saveWanted(set);
                    $("mod-count").textContent = `${shown.length} of ${library.mods.length} · ${set.size} in your list`;
                });
                const meta = document.createElement("div");
                meta.className = "meta";
                const name = document.createElement("strong");
                name.textContent = `${m.name}  ·  ${m.group}`;
                const about = document.createElement("span");
                about.textContent = m.about;
                const from = document.createElement("span");
                from.className = "hint";
                from.textContent = `Ported from ${m.from}`;
                meta.append(name, about, from);
                const link = (label, href) => {
                    const a = document.createElement("a");
                    a.className = "join";
                    a.textContent = label;
                    a.href = href;
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                    return a;
                };
                li.append(check, meta,
                    link("Source", `${library.repo}/tree/main/mods/${encodeURIComponent(m.slug)}`),
                    link("Releases", `${library.repo}/releases?q=${encodeURIComponent(m.slug)}`));
                return li;
            }),
        );
    }

    async function init() {
        try {
            library = await (await fetch(MODS_URL)).json();
        } catch {
            note.textContent = "Couldn't load the mod list.";
            return;
        }
        $("mod-zip").href = library.zip;
        const groups = [...new Set(library.mods.map((m) => m.group))].sort();
        $("mod-group").replaceChildren(new Option("All categories", ""), ...groups.map((g) => new Option(g, g)));
        render();
    }
    $("mod-search").addEventListener("input", render);
    $("mod-group").addEventListener("change", render);
    $("mod-copy").addEventListener("click", async () => {
        const slugs = [...wanted()];
        if (!slugs.length) return (note.textContent = "Tick some mods first.");
        try {
            await navigator.clipboard.writeText(slugs.join("\n"));
            note.textContent = `Copied ${slugs.length} mod name${slugs.length === 1 ? "" : "s"}.`;
        } catch {
            note.textContent = slugs.join(", ");
        }
    });
    init();
}

// ---- Accounts, staff, announcements and the shout ----
{
    const RANK = { user: 0, mod: 1, janitor: 2, admin: 3, owner: 4 };
    const rank = () => RANK[acct?.me.role] ?? 0;
    const isOwner = () => rank() === RANK.owner;
    let acct = null; // { me, data } while logged in
    let site = null; // what the last presence ping heard
    let lastBlock = "";

    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    };
    const say = (node, text, bad = false) => {
        node.textContent = text ?? "";
        node.hidden = !text;
        node.classList.toggle("err", bad);
    };
    const when = (at) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

    // ---- who is logged in
    function paintAccount() {
        const me = acct?.me;
        $("acct-out").hidden = Boolean(me);
        $("acct-in").hidden = !me;
        $("nav-staff").hidden = rank() < RANK.mod;
        $("acct-nametag").hidden = !isOwner();
        paintShout();
        if (!me) return;
        nametag($("acct-me"), me.name, me.nametag);
        $("acct-role").textContent = me.role;
        $("acct-role").hidden = me.role === "user";
        if (document.activeElement !== $("acct-skin")) $("acct-skin").value = me.skin;
        if (isOwner()) {
            const tag = me.nametag ?? { mode: "rainbow" };
            for (const b of $("tag-seg").querySelectorAll("button")) b.classList.toggle("on", b.dataset.value === tag.mode);
            if (tag.color) $("tag-color").value = tag.color;
            nametag($("tag-preview"), me.name, tag);
        }
    }

    async function refreshMe() {
        try {
            const data = await account.me();
            acct = data ? { me: data.me, data: data.data } : null;
        } catch {
            // Offline: keep what is shown.
        }
        paintAccount();
        if (!location.hash.startsWith("#staff")) return;
        if (rank() >= RANK.mod) renderStaff();
        else location.hash = "#play";
    }

    const fail = (box, e) => say(box, e.message || "Something went wrong.", true);

    $("acct-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        say($("acct-error"), "");
        try {
            await account.login($("acct-name").value, $("acct-pass").value);
            $("acct-pass").value = "";
            await afterLogin();
        } catch (err) {
            fail($("acct-error"), err);
        }
    });
    $("acct-signup").addEventListener("click", async () => {
        if (!$("acct-form").reportValidity()) return;
        say($("acct-error"), "");
        try {
            await account.signup($("acct-name").value, $("acct-pass").value);
            $("acct-pass").value = "";
            await afterLogin();
        } catch (err) {
            fail($("acct-error"), err);
        }
    });
    async function afterLogin() {
        await refreshMe();
        refreshSite();
        // A new account's skin name starts as the one picked on the Profile page.
        if (acct && !acct.me.skin) {
            try {
                const skin = (await profile.load()).skin;
                if (skin) await account.api("/api/account/skin", { skin });
                await refreshMe();
            } catch {}
        }
    }
    $("acct-logout").addEventListener("click", async () => {
        await account.logout().catch(() => {});
        acct = null;
        paintAccount();
        refreshSite();
    });
    $("acct-skin-save").addEventListener("click", async () => {
        try {
            acct.me = (await account.api("/api/account/skin", { skin: $("acct-skin").value })).me;
            paintAccount();
        } catch (e) {
            say($("cloud-note"), e.message, true);
        }
    });

    // ---- the owner's nametag
    async function setTag(mode) {
        try {
            acct.me = (await account.api("/api/account/nametag", { mode, color: $("tag-color").value })).me;
            paintAccount();
            refreshSite();
        } catch (e) {
            say($("cloud-note"), e.message, true);
        }
    }
    $("tag-seg").addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (b) setTag(b.dataset.value);
    });
    $("tag-color").addEventListener("change", () => setTag("color"));

    // ---- cloud save
    const cloud = $("cloud-note");
    const busy = (on) => {
        for (const id of ["cloud-save", "cloud-load", "cloud-delete"]) $(id).disabled = on;
    };
    async function cloudDo(work, done) {
        busy(true);
        say(cloud, "Working…");
        try {
            say(cloud, await done(await work((i, n) => say(cloud, `Working… ${i + 1} of ${n}`))));
        } catch (e) {
            say(cloud, e.message, true);
        } finally {
            busy(false);
        }
    }
    $("cloud-save").addEventListener("click", () =>
        cloudDo(account.saveToCloud, ({ files, skipped }) => `Saved this browser's settings and ${files} file${files === 1 ? "" : "s"}${skipped ? `. ${skipped} were too big to fit and were left out` : ""}.`));
    $("cloud-load").addEventListener("click", () => {
        if (!confirm("Load your cloud save? It replaces your launcher settings and the default instance's files on this device.")) return;
        cloudDo(account.loadFromCloud, ({ files }) => `Loaded settings and ${files} file${files === 1 ? "" : "s"}. Reload the page to apply them.`);
    });
    $("cloud-delete").addEventListener("click", () => {
        if (!confirm("Delete your cloud save? Your files on this device stay.")) return;
        cloudDo(() => account.api("/api/data/delete"), () => "Cloud save deleted.");
    });

    // ---- the shout (home page)
    function paintShout() {
        const shout = site?.shout;
        const owner = isOwner();
        $("shout").hidden = !shout;
        if (shout) {
            nametag($("shout-by"), shout.by, site.owner?.nametag);
            $("shout-time").textContent = when(shout.at);
            richText($("shout-text"), shout.text);
        }
        $("shout-edit").hidden = !(owner && shout);
        $("shout-new").hidden = !(owner && !shout) || !$("shout-form").hidden;
        if (!owner) $("shout-form").hidden = true;
    }
    const openShoutForm = (on) => {
        $("shout-form").hidden = !on;
        if (on) {
            $("shout-input").value = site?.shout?.text ?? "";
            $("shout-input").focus();
        }
        paintShout();
    };
    $("shout-edit").addEventListener("click", () => openShoutForm(true));
    $("shout-new").addEventListener("click", () => openShoutForm(true));
    $("shout-cancel").addEventListener("click", () => openShoutForm(false));
    async function sendShout(text) {
        try {
            await account.api("/api/owner/shout", { text });
            openShoutForm(false);
            refreshSite();
        } catch (e) {
            alert(e.message);
        }
    }
    $("shout-form").addEventListener("submit", (e) => {
        e.preventDefault();
        sendShout($("shout-input").value);
    });
    $("shout-clear").addEventListener("click", () => sendShout(""));

    // ---- what the presence ping hears
    watchSite();
    document.addEventListener("horizon:site", (event) => {
        site = event.detail;
        // A role or ban changed on the server: bring this page up to date.
        if ((site.me?.role ?? null) !== (acct?.me.role ?? null) || (site.me?.name ?? null) !== (acct?.me.name ?? null)) {
            if (site.me || acct) refreshMe();
        }
        paintShout();
        const reason = blockedReason();
        if (reason && reason !== lastBlock) {
            showNotice({ title: "Notice", text: reason === "kicked" ? MESSAGES.kicked(site.status.kickedUntil) : MESSAGES[reason] });
        }
        lastBlock = reason;
    });
    // Banned or kicked: Launch and Join don't open the game.
    document.addEventListener("click", (e) => {
        const reason = blockedReason();
        if (!reason || !e.target.closest('a[href*="game.html"], a[href*="NEWgame.html"]')) return;
        e.preventDefault();
        e.stopPropagation();
        showNotice({ title: "Can't play", text: reason === "kicked" ? MESSAGES.kicked(site?.status.kickedUntil) : MESSAGES[reason] });
    }, true);
    const flash = takeFlash();
    if (flash) showNotice({ title: "Notice", text: flash });
    refreshMe();

    // ---- staff
    const err = $("staff-error");
    const call = async (path, body) => {
        say(err, "");
        try {
            const data = await account.api(path, body);
            await renderStaff();
            return data;
        } catch (e) {
            fail(err, e);
            return null;
        }
    };
    const chip = (text, kind = "mute") => el("span", `chip ${kind}`, text);

    function personRow(u) {
        const li = el("li", "server person");
        const meta = el("div", "meta");
        const name = el("b");
        nametag(name, u.name, u.nametag);
        meta.append(name, el("small", "", u.skin ? `skin: ${u.skin}` : "no skin name"));
        const chips = el("div", "acts");
        if (u.role !== "user") chips.append(chip(u.role, ""));
        if (u.banned) chips.append(chip("banned", "bad"));
        if (u.kickedUntil) chips.append(chip(`kicked until ${new Date(u.kickedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, "bad"));
        if (u.ipBanned) chips.append(chip("IP banned", "bad"));
        const acts = el("div", "acts");
        const button = (label, need, path) => {
            if (rank() < RANK[need]) return;
            const b = el("button", "ghost", label);
            b.type = "button";
            b.disabled = !u.canAct;
            b.addEventListener("click", () => {
                if (confirm(`${label} ${u.name}? You can undo it from the activity list.`)) call(path, { name: u.name });
            });
            acts.append(b);
        };
        button("Kick", "mod", "/api/staff/kick");
        button("Ban", "janitor", "/api/staff/ban");
        button("IP ban", "admin", "/api/staff/ipban");
        if (isOwner() && u.canAct) {
            const select = el("select");
            select.setAttribute("aria-label", `role of ${u.name}`);
            for (const role of ["user", "mod", "janitor", "admin"]) select.append(new Option(role, role, false, role === u.role));
            select.addEventListener("change", () => call("/api/staff/role", { name: u.name, role: select.value }));
            acts.append(select);
        }
        li.append(meta, chips, acts);
        return li;
    }

    const describe = (a) => {
        switch (a.type) {
            case "kick": return `${a.by} kicked ${a.target}`;
            case "ban": return `${a.by} banned ${a.target}`;
            case "ipban": return `${a.by} IP banned ${a.target} (${a.mask})`;
            case "unipban": return `${a.by} lifted the IP ban on ${a.target ?? "a network"} (${a.mask})`;
            case "role": return `${a.by} made ${a.target} ${a.to} (was ${a.from})`;
            default: return `${a.by}: ${a.type}`;
        }
    };

    function logRow(a) {
        const li = el("li", "server logrow");
        const meta = el("div", "meta");
        meta.append(el("b", a.undone ? "undone" : "", describe(a)), el("small", "", a.undone ? `${when(a.at)} · undone by ${a.undone.by}` : when(a.at)));
        li.append(meta);
        if (!a.undone) {
            const b = el("button", "ghost", "Undo");
            b.type = "button";
            b.disabled = !a.canUndo;
            b.addEventListener("click", () => call("/api/staff/undo", { id: a.id }));
            li.append(b);
        }
        return li;
    }

    function ipRow(b) {
        const li = el("li", "server");
        const meta = el("div", "meta");
        meta.append(el("b", "", b.mask), el("small", "", `${b.target ? `${b.target} · ` : ""}banned by ${b.by} · ${when(b.at)}`));
        const un = el("button", "ghost", "Unban");
        un.type = "button";
        un.addEventListener("click", () => call("/api/staff/unipban", { id: b.id }));
        li.append(meta, un);
        return li;
    }

    let searchTimer = 0;
    $("staff-search").addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(renderStaff, 250);
    });
    $("ann-send").addEventListener("click", async () => {
        const text = $("ann-input").value.trim();
        if (!text) return say($("ann-note"), "Write something first.", true);
        try {
            const sent = await account.api("/api/owner/announce", { text });
            if (sent.announcement) markSeen(sent.announcement.id);
            say($("ann-note"), "Sent. Everyone online sees it within about 20 seconds, once.");
            refreshSite();
        } catch (e) {
            say($("ann-note"), e.message, true);
        }
    });
    $("ann-clear").addEventListener("click", async () => {
        try {
            await account.api("/api/owner/announce", { text: "" });
            say($("ann-note"), "Withdrawn. People who haven't seen it yet won't.");
        } catch (e) {
            say($("ann-note"), e.message, true);
        }
    });
    $("ann-preview").addEventListener("click", () => showNotice({ title: "Notice", text: $("ann-input").value || "(nothing yet)", by: acct?.me }));

    async function renderStaff() {
        if (rank() < RANK.mod) return;
        $("staff-sub").textContent = `You are ${acct.me.role === "owner" ? "the owner" : `a ${acct.me.role}`}. ${
            rank() >= RANK.admin ? "You can kick, ban and IP ban." : rank() >= RANK.janitor ? "You can kick and ban." : "You can kick."}${isOwner() ? " You also change roles, send announcements and set the shout." : ""}`;
        $("owner-tools").hidden = !isOwner();
        $("ipban-panel").hidden = rank() < RANK.admin;
        try {
            const [found, log, bans] = await Promise.all([
                account.api("/api/staff/search", { q: $("staff-search").value }),
                account.api("/api/staff/log"),
                rank() >= RANK.admin ? account.api("/api/staff/ipbans") : { bans: [] },
            ]);
            $("staff-list").replaceChildren(...found.users.map(personRow));
            $("staff-empty").textContent = found.users.length ? "" : "No players match.";
            $("log-list").replaceChildren(...log.actions.map(logRow));
            $("log-empty").textContent = log.actions.length ? "" : "Nothing yet.";
            $("ipban-list").replaceChildren(...bans.bans.map(ipRow));
            $("ipban-empty").textContent = bans.bans.length ? "" : "No networks are banned.";
        } catch (e) {
            fail(err, e);
        }
    }
    globalThis.renderStaff = renderStaff;
}
