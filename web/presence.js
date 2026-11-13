// Talks to the rooms service (web/rooms-service) for both pages:
//  - startPresence(): tells it this tab is here and hears how many are online.
//  - watchSharedWorld(): lists the shared world this tab hosts as a public room,
//    unless the player switched it off (the launcher's minecraft page has the switch).
import { ROOMS_API } from "./config.js";

const PRESENCE_MS = 20_000;
const HEARTBEAT_MS = 10_000;
const PUBLIC_KEY = "horizon-public-room";

const safe = (fn, fallback) => {
    try {
        return fn();
    } catch {
        return fallback;
    }
};
const uuid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const configured = () => Boolean(ROOMS_API);
// On unless the player turned it off: only an explicit "0" is off.
export const publicRoomsOn = () => safe(() => localStorage.getItem(PUBLIC_KEY) !== "0", true);
export const setPublicRooms = (on) => safe(() => localStorage.setItem(PUBLIC_KEY, on ? "1" : "0"));

// One id per tab, kept when the launcher opens the game in the same tab, so
// moving between the two pages doesn't count twice.
const sessionId = safe(() => {
    let id = sessionStorage.getItem("horizon-session");
    if (!id) sessionStorage.setItem("horizon-session", (id = uuid()));
    return id;
}, uuid());

// Sent as text/plain so the browser makes no CORS preflight; the body is JSON.
function post(path, body, keepalive = false) {
    return fetch(`${ROOMS_API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(body),
        keepalive,
    });
}

export async function startPresence(onOnline) {
    if (!configured()) return;
    const ping = async () => {
        try {
            const response = await post("/api/presence", { id: sessionId });
            if (response.ok) onOnline?.((await response.json()).online);
        } catch {
            // Offline or the service is down: the count just doesn't update.
        }
    };
    ping();
    setInterval(ping, PRESENCE_MS);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) ping();
    });
}

export function watchSharedWorld() {
    if (!configured()) return;
    let room = null; // { code, name, owner, players, key }
    let timer = null;
    let listed = false;

    const body = () => ({ code: room.code, key: room.key, owner: room.owner, name: room.name, players: room.players });
    const beat = async () => {
        if (!room) return;
        if (!publicRoomsOn()) {
            // Switched off since: take the room down once.
            if (listed) await post("/api/rooms/close", { code: room.code, key: room.key }).catch(() => {});
            listed = false;
            return;
        }
        listed = true;
        await post("/api/rooms/heartbeat", body()).catch(() => {});
    };
    const stop = () => {
        clearInterval(timer);
        timer = null;
        if (room && listed) {
            const close = JSON.stringify({ code: room.code, key: room.key });
            // keepalive so it still goes if the tab is closing.
            fetch(`${ROOMS_API}/api/rooms/close`, {
                method: "POST", headers: { "Content-Type": "text/plain" }, body: close, keepalive: true,
            }).catch(() => {});
        }
        room = null;
        listed = false;
    };

    // The game's shared worlds report here (horizon-os net.rs).
    globalThis.horizonSharedWorld = (event) => {
        if (event.kind === "open") {
            stop();
            room = { code: event.code, name: event.name, owner: event.owner, players: event.players, key: uuid() };
            beat();
            timer = setInterval(beat, HEARTBEAT_MS);
        } else if (room && event.code === room.code) {
            if (event.kind === "players") {
                room.players = event.players;
                beat();
            } else if (event.kind === "closed") {
                stop();
            }
        }
    };
    addEventListener("pagehide", stop);
}
