// Cloudflare Worker for z's horizon: the public rooms and the online count.
// One Durable Object holds the registry in memory (heartbeats are too
// frequent for KV's write limits, and everything expires in under a minute
// anyway), so every request goes through it.
import { DurableObject } from "cloudflare:workers";
import { Registry } from "./registry.js";
import { DEFAULT_STUN, Relay } from "./relay.js";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
};

const json = (status, data) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

export class RegistryObject extends DurableObject {
    registry = new Registry();

    async fetch(request) {
        const url = new URL(request.url);
        let body = null;
        if (request.method === "POST") {
            // Sent as text/plain by the pages (no CORS preflight); it is JSON.
            try {
                const raw = await request.text();
                if (raw.length > 4096) return json(413, { error: "too large" });
                body = raw ? JSON.parse(raw) : null;
            } catch {
                return json(400, { error: "bad json" });
            }
        }
        const [status, data] = this.registry.handle(request.method, url.pathname, body);
        return json(status, data);
    }
}

// The shared-world relay (relay.js): one object holds every code, so a player
// anywhere reaches the host who made it. Optional TURN for players behind
// strict NATs: set TURN_URL, TURN_USER and TURN_PASS (wrangler secret / vars).
export class RelayObject extends DurableObject {
    constructor(state, env) {
        super(state, env);
        const servers = DEFAULT_STUN.map((url) => ({ url }));
        if (env.TURN_URL) servers.push({ url: env.TURN_URL, username: env.TURN_USER ?? "", credential: env.TURN_PASS ?? "" });
        this.relay = new Relay({ iceServers: servers });
    }

    async fetch(request) {
        if (request.headers.get("Upgrade") !== "websocket") return new Response("expected a WebSocket", { status: 426 });
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();
        server.binaryType = "arraybuffer";
        const { onMessage, onClose } = this.relay.connect({
            send: (bytes) => server.send(bytes),
            close: (code, reason) => server.close(code ?? 1000, reason),
        });
        server.addEventListener("message", (e) => {
            if (e.data instanceof ArrayBuffer) onMessage(new Uint8Array(e.data));
        });
        server.addEventListener("close", onClose);
        server.addEventListener("error", onClose);
        return new Response(null, { status: 101, webSocket: client });
    }
}

export default {
    async fetch(request, env) {
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
        const url = new URL(request.url);
        if (url.pathname === "/") return json(200, { service: "z's horizon rooms" });
        if (url.pathname === "/relay") return env.RELAY.get(env.RELAY.idFromName("relay")).fetch(request);
        const stub = env.REGISTRY.get(env.REGISTRY.idFromName("registry"));
        return stub.fetch(request);
    },
};
