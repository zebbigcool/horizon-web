// The launcher's server list: servers the player added (kept in this browser),
// their status (name, message of the day, players, ping) asked over a
// WebSocket, and the address the game is started with to join one.
//
// Two kinds of address, as the game reads them: "host:port" is a Horizon (or
// Minecraft) server that takes WebSockets beside its own port, asked with
// Minecraft's status handshake; "ws://..." / "wss://..." is an Eaglercraft
// server, asked with its plugin's "Accept: MOTD" text query.

const KEY = "horizon-servers";
const TIMEOUT_MS = 6000;

export const isEagler = (address) => /^wss?:\/\//i.test(address);

export function load() {
    try {
        const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
        return Array.isArray(list)
            ? list.filter((s) => s && typeof s.address === "string").map((s) => ({ name: String(s.name || s.address), address: s.address }))
            : [];
    } catch {
        return [];
    }
}
export function save(list) {
    try {
        localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
        // Storage blocked: the list just doesn't stick.
    }
}

// An address as typed -> the form the game takes, or null if it isn't one.
export function normalize(text) {
    const value = text.trim();
    if (isEagler(value)) {
        try {
            return new URL(value).host ? value : null;
        } catch {
            return null;
        }
    }
    // host or host:port (a bracketed IPv6 address is not supported here).
    return /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/.test(value) ? value : null;
}

// Where the page opens its WebSocket for a plain address: wss on an https page.
export function socketUrl(address, protocol = globalThis.location?.protocol) {
    if (isEagler(address)) return address;
    return `${protocol === "https:" ? "wss" : "ws"}://${address}/`;
}

// The start page's address for joining: the game reads ?args= as its command line.
export function joinUrl(gameUrl, address) {
    return `${gameUrl}?args=${encodeURIComponent(`--server ${address}`)}`;
}

// ---- Minecraft's status packets

const varint = (n) => {
    const out = [];
    do {
        let byte = n & 0x7f;
        n >>>= 7;
        if (n) byte |= 0x80;
        out.push(byte);
    } while (n);
    return out;
};
const text = (s) => {
    const b = new TextEncoder().encode(s);
    return [...varint(b.length), ...b];
};
const framed = (body) => new Uint8Array([...varint(body.length), ...body]);

export function readVarint(bytes, at = 0) {
    let value = 0;
    for (let i = 0; i < 5; i++) {
        if (at + i >= bytes.length) return null;
        const byte = bytes[at + i];
        value |= (byte & 0x7f) << (7 * i);
        if (!(byte & 0x80)) return { value, next: at + i + 1 };
    }
    return null;
}

// The handshake (next state: status) and the status request.
export function statusRequest(host, port) {
    const handshake = [0x00, ...varint(777), ...text(host), (port >> 8) & 255, port & 255, 1];
    const merged = new Uint8Array([...framed(handshake), ...framed([0x00])]);
    return merged;
}

// The JSON out of a status response packet, or null while it isn't all here.
export function readStatus(bytes) {
    const length = readVarint(bytes, 0);
    if (!length || bytes.length < length.next + length.value) return null;
    const id = readVarint(bytes, length.next);
    if (!id || id.value !== 0) throw new Error("not a status response");
    const size = readVarint(bytes, id.next);
    if (!size) return null;
    return JSON.parse(new TextDecoder().decode(bytes.subarray(size.next, size.next + size.value)));
}

// ---- turning either answer into one shape

// Minecraft's formatting codes (section sign + a character) are dropped.
export const plain = (s) => String(s).replace(/§[0-9a-fk-or]/gi, "");

function flatten(description) {
    if (typeof description === "string") return description;
    if (Array.isArray(description)) return description.map(flatten).join("");
    if (description && typeof description === "object") {
        return (description.text ?? "") + (description.extra ? flatten(description.extra) : "");
    }
    return "";
}

// A vanilla status JSON -> { motd, online, max, version }.
export function fromVanilla(json) {
    return {
        motd: plain(flatten(json.description)).split("\n").map((l) => l.trim()).filter(Boolean),
        online: Number(json.players?.online ?? 0),
        max: Number(json.players?.max ?? 0),
        version: json.version?.name ?? "",
    };
}

// An EaglercraftXServer "Accept: MOTD" answer -> the same.
export function fromEagler(json) {
    const data = json.data ?? json;
    const lines = Array.isArray(data.motd) ? data.motd : typeof data.motd === "string" ? data.motd.split("\n") : [];
    const players = data.players;
    return {
        name: json.name,
        motd: lines.map((l) => plain(l).trim()).filter(Boolean),
        online: Number(data.online ?? players?.online ?? 0),
        max: Number(data.max ?? players?.max ?? 0),
        version: json.vers ?? "",
    };
}

// Asks a server for its status: resolves { motd, online, max, version, ping } or
// rejects with a short reason. WebSocketImpl is for tests.
export function query(address, WebSocketImpl = globalThis.WebSocket) {
    return new Promise((resolve, reject) => {
        let socket;
        let started = 0;
        let buffer = new Uint8Array(0);
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                socket?.close();
            } catch {
                // Already closed.
            }
            fn(value);
        };
        const timer = setTimeout(() => finish(reject, new Error("no answer")), TIMEOUT_MS);
        try {
            socket = new WebSocketImpl(socketUrl(address));
        } catch (e) {
            return finish(reject, new Error("bad address"));
        }
        socket.binaryType = "arraybuffer";
        const eagler = isEagler(address);
        socket.onopen = () => {
            started = performance.now();
            if (eagler) {
                socket.send("Accept: MOTD");
            } else {
                const [host, port] = address.split(":");
                socket.send(statusRequest(host, Number(port) || 25565));
            }
        };
        socket.onerror = () => finish(reject, new Error("can't connect"));
        socket.onclose = () => finish(reject, new Error("closed"));
        socket.onmessage = ({ data }) => {
            try {
                const ping = Math.round(performance.now() - started);
                if (eagler) {
                    if (typeof data !== "string") return;
                    const json = JSON.parse(data);
                    if (json.type && json.type !== "motd") return;
                    finish(resolve, { ...fromEagler(json), ping });
                } else {
                    const more = new Uint8Array(data);
                    const joined = new Uint8Array(buffer.length + more.length);
                    joined.set(buffer);
                    joined.set(more, buffer.length);
                    buffer = joined;
                    const json = readStatus(buffer);
                    if (json) finish(resolve, { ...fromVanilla(json), ping });
                }
            } catch (e) {
                finish(reject, new Error("unexpected answer"));
            }
        };
    });
}
