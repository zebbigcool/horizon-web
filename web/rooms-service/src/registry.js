// The rooms registry's logic, with no Cloudflare in it so it can be tested in
// Node: who is online (a heartbeat per browser tab) and which shared worlds
// are open and public (a heartbeat per world). Everything expires on its own.

export const ONLINE_TTL_MS = 45_000;
export const ROOM_TTL_MS = 30_000;
const MAX_ONLINE = 20_000;
const MAX_ROOMS = 500;

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const count = (value, min, max) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};

export class Registry {
    constructor() {
        /** @type {Map<string, number>} tab id -> last seen */
        this.online = new Map();
        /** @type {Map<string, object>} room code -> room */
        this.rooms = new Map();
    }

    prune(now) {
        for (const [id, seen] of this.online) if (now - seen > ONLINE_TTL_MS) this.online.delete(id);
        for (const [code, room] of this.rooms) if (now - room.seen > ROOM_TTL_MS) this.rooms.delete(code);
    }

    /** A tab says it's here: the number of tabs online, itself included. */
    presence(id, now) {
        const key = text(id, 64);
        if (!key) return { error: "id required" };
        this.prune(now);
        if (this.online.has(key) || this.online.size < MAX_ONLINE) this.online.set(key, now);
        return { online: this.online.size };
    }

    /**
     * A host says its shared world is open. The first heartbeat for a code
     * sets its `key`; later ones and its close must bring the same key, so
     * nobody else can take the entry over.
     */
    heartbeat(body, now) {
        const code = text(body?.code, 40);
        const key = text(body?.key, 64);
        const owner = text(body?.owner, 32);
        if (!code || !key || !owner) return { error: "code, key and owner required" };
        this.prune(now);
        const known = this.rooms.get(code);
        if (known && known.key !== key) return { error: "code in use", status: 409 };
        if (!known && this.rooms.size >= MAX_ROOMS) return { error: "too many rooms", status: 429 };
        const players = count(body.players, 1, 1000);
        const max = count(body.maxPlayers, 0, 1000);
        this.rooms.set(code, {
            key,
            code,
            owner,
            name: text(body.name, 64),
            players,
            maxPlayers: max || undefined,
            seen: now,
        });
        return {};
    }

    close(body, now) {
        const code = text(body?.code, 40);
        const known = this.rooms.get(code);
        if (known && known.key === text(body?.key, 64)) this.rooms.delete(code);
        this.prune(now);
        return {};
    }

    /** The public rooms, newest activity first, and who is online. */
    list(now) {
        this.prune(now);
        const rooms = [...this.rooms.values()]
            .sort((a, b) => b.seen - a.seen)
            .map(({ code, owner, name, players, maxPlayers }) => ({
                code,
                owner,
                ...(name ? { name } : {}),
                players,
                ...(maxPlayers ? { maxPlayers } : {}),
                public: true,
            }));
        return { rooms, online: this.online.size };
    }

    /** A request's path and parsed body to the right method: [status, json]. */
    handle(method, path, body, now = Date.now()) {
        const done = (result, ok = 200) => (result.error ? [result.status ?? 400, { error: result.error }] : [ok, result]);
        if (method === "GET" && path === "/api/rooms") return [200, this.list(now)];
        if (method === "GET" && path === "/api/online") {
            this.prune(now);
            return [200, { online: this.online.size }];
        }
        if (method === "POST" && path === "/api/presence") return done(this.presence(body?.id, now));
        if (method === "POST" && path === "/api/rooms/heartbeat") return done(this.heartbeat(body, now), 200);
        if (method === "POST" && path === "/api/rooms/close") return done(this.close(body, now), 200);
        return [404, { error: "not found" }];
    }
}
