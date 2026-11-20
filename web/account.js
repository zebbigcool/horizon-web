// The account API for the launcher: sign up, log in, the staff tools, the
// owner's notices and cloud save. Everything goes through the rooms service.
import { roomsFetch } from "./presence.js";
import { setToken, token } from "./session.js";

// Sent as text/plain so the browser makes no CORS preflight; the body is JSON.
export async function api(path, body = {}) {
    const response = await roomsFetch(path, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ ...body, token: token() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error ?? `${response.status} ${response.statusText}`), { status: response.status });
    return data;
}

export const loggedIn = () => Boolean(token());

export async function signup(name, password) {
    const data = await api("/api/account/signup", { name, password });
    setToken(data.token);
    return data.me;
}

export async function login(name, password) {
    const data = await api("/api/account/login", { name, password });
    setToken(data.token);
    return data.me;
}

export async function logout() {
    try {
        await api("/api/account/logout");
    } finally {
        setToken("");
    }
}

/** Who is logged in (null when nobody, or the session ran out). */
export async function me() {
    if (!token()) return null;
    try {
        return await api("/api/account/me");
    } catch (e) {
        if (e.status === 401) setToken("");
        else throw e;
        return null;
    }
}

/**
 * Keeps the game told who this player is: fetches a short-lived signed badge (and the key
 * badges are checked with) now and every few minutes, and hands both to `give(badge, key)`.
 * A shared world's host uses them to know the real owner from someone with the same name.
 * Nothing is fetched while logged out, and a server without badges set up is simply skipped.
 */
export function keepBadge(give) {
    let key = "";
    const refresh = async () => {
        try {
            if (!key) key = (await (await roomsFetch("/api/badge-key")).json()).key ?? "";
        } catch {
            key = "";
        }
        let badge = "";
        try {
            if (key && loggedIn()) badge = (await api("/api/account/badge")).badge;
        } catch {
            badge = "";
        }
        try {
            give(badge, key);
        } catch {
            // An older game build without the hook.
        }
    };
    refresh();
    setInterval(refresh, 4 * 60 * 1000);
}

// ---- cloud save: this browser's launcher data and the default instance's small files

const CHUNK = 450_000; // characters per request (the service takes 700 000)
const MAX_BYTES = 12 * 1024 * 1024; // before compression
const PREFIX = "horizon";

const b64 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
};
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function gzip(bytes, kind) {
    const stream = new Blob([bytes]).stream().pipeThrough(new (kind === "in" ? CompressionStream : DecompressionStream)("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function files(dir, base = "") {
    const out = [];
    for await (const [name, handle] of dir.entries()) {
        if (handle.kind === "directory") out.push(...(await files(handle, `${base}${name}/`)));
        else out.push([`${base}${name}`, handle]);
    }
    return out;
}

/** Collects what is worth keeping: launcher settings, and the files under OPFS horizon/ . */
async function bundle() {
    const settings = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(PREFIX) && key !== "horizon-account-token" && key !== "horizon-session" && !key.startsWith("horizon-seen")) settings[key] = localStorage.getItem(key);
    }
    const list = [];
    let total = JSON.stringify({ settings }).length;
    let skipped = 0;
    try {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("horizon");
        for (const [path, handle] of await files(root)) {
            const file = await handle.getFile();
            if (total + file.size > MAX_BYTES) {
                skipped++;
                continue;
            }
            total += file.size;
            list.push({ path, size: file.size, handle });
        }
    } catch {
        // No game folder yet.
    }
    // Layout: [4-byte header length][header json][file bytes...]
    const header = new TextEncoder().encode(JSON.stringify({ settings, files: list.map(({ path, size }) => ({ path, size })) }));
    const out = new Uint8Array(4 + header.length + list.reduce((n, f) => n + f.size, 0));
    new DataView(out.buffer).setUint32(0, header.length);
    out.set(header, 4);
    let at = 4 + header.length;
    for (const f of list) {
        out.set(new Uint8Array(await (await f.handle.getFile()).arrayBuffer()), at);
        at += f.size;
    }
    return { bytes: out, count: list.length, skipped };
}

export async function saveToCloud(progress = () => {}) {
    const { bytes, count, skipped } = await bundle();
    const text = b64(await gzip(bytes, "in"));
    const total = Math.max(1, Math.ceil(text.length / CHUNK));
    if (total > 24) throw new Error("That's more than the 12 MB the cloud save keeps. Delete some worlds and try again.");
    const gen = Date.now().toString(36);
    for (let i = 0; i < total; i++) {
        progress(i, total);
        await api("/api/data/put", { gen, index: i, total, chunk: text.slice(i * CHUNK, (i + 1) * CHUNK) });
    }
    return { files: count, skipped };
}

export async function loadFromCloud(progress = () => {}) {
    const info = (await api("/api/data/info")).data;
    if (!info) throw new Error("Nothing is saved in the cloud yet.");
    let text = "";
    for (let i = 0; i < info.chunks; i++) {
        progress(i, info.chunks);
        text += (await api("/api/data/get", { index: i })).chunk;
    }
    const bytes = await gzip(unb64(text), "out");
    const headerLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)));
    for (const [key, value] of Object.entries(header.settings ?? {})) {
        if (key.startsWith(PREFIX)) localStorage.setItem(key, value);
    }
    let at = 4 + headerLength;
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("horizon", { create: true });
    for (const { path, size } of header.files ?? []) {
        if (path.split("/").some((p) => p === ".." || p === "." || !p)) throw new Error("The save holds a bad file name.");
        let dir = root;
        const parts = path.split("/");
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
        const out = await (await dir.getFileHandle(parts.at(-1), { create: true })).createWritable();
        await out.write(bytes.subarray(at, at + size));
        await out.close();
        at += size;
    }
    return { files: (header.files ?? []).length };
}
