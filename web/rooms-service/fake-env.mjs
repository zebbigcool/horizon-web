// Runs the real Worker (src/index.js) in Node, for tests: `cloudflare:workers` is
// replaced by a minimal DurableObject, and the bindings are in-memory objects.
import { register } from "node:module";

register(
    "data:text/javascript," +
        encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject{constructor(s,e){this.ctx=s;this.env=e}}", shortCircuit: true };
  return next(s, c);
}`),
    import.meta.url,
);

const storage = () => {
    const map = new Map();
    return {
        get: async (k) => structuredClone(map.get(k)),
        put: async (k, v) => void map.set(k, structuredClone(v)),
        delete: async (k) => void map.delete(k),
        list: async ({ prefix }) => new Map([...map].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])),
    };
};

export async function makeWorker(vars = {}) {
    const mod = await import("./src/index.js");
    const env = { ...vars };
    const binding = (Class) => {
        let instance;
        return {
            idFromName: (n) => n,
            get: () => (instance ??= new Class({ storage: storage(), blockConcurrencyWhile: (f) => f() }, env)),
        };
    };
    for (const [name, Class] of [["REGISTRY", mod.RegistryObject], ["ACCOUNTS", mod.AccountsObject], ["RELAY", mod.RelayObject], ["DRAW", mod.DrawObject]]) {
        const b = binding(Class);
        env[name] = { idFromName: b.idFromName, get: () => {
            const o = b.get();
            return { fetch: (url, init) => o.fetch(url instanceof Request ? url : new Request(url, init)) };
        } };
    }
    return { fetch: (request) => mod.default.fetch(request, env) };
}
