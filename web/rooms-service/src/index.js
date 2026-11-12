// Cloudflare Worker for z's horizon: the public rooms and the online count.
// One Durable Object holds the registry in memory (heartbeats are too
// frequent for KV's write limits, and everything expires in under a minute
// anyway), so every request goes through it.
import { DurableObject } from "cloudflare:workers";
import { Registry } from "./registry.js";

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

export default {
    async fetch(request, env) {
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
        const url = new URL(request.url);
        if (url.pathname === "/") return json(200, { service: "z's horizon rooms" });
        const stub = env.REGISTRY.get(env.REGISTRY.idFromName("registry"));
        return stub.fetch(request);
    },
};
