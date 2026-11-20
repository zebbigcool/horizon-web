// Accounts, staff roles, moderation, announcements and the owner's shout, with
// no Cloudflare in it so it can be tested in Node. It talks to a `store`
// (get/put/delete/list of JSON values; a Durable Object's storage in the Worker)
// and writes through to it on every change.
//
// Who may do what (a higher rank can act on a lower one, never the reverse):
//   user 0, mod 1 (kick), janitor 2 (kick, ban), admin 3 (kick, ban, IP ban),
//   owner 4 (everything: roles, nametag, announcements, shout).
// Every moderation action is logged and can be undone by someone of the rank
// that could have done it (and not lower than whoever did it).
//
// An account has a username (unique, can't be taken twice, what staff act on: like a
// Discord @handle) and a display name (free to copy; it is the player's name in the
// game and on lists). The owner is the account named OWNER_NAME. Its password is never stored in
// the code or the data: it is the ADMIN_PASSWORD secret of the Worker, and
// while that is unset the owner can't log in.

export const OWNER_NAME = "Zeb";
export const RANKS = { user: 0, mod: 1, janitor: 2, admin: 3, owner: 4 };
export const ASSIGNABLE = ["user", "mod", "janitor", "admin"];
export const KICK_MS = 10 * 60 * 1000;
export const SESSION_MS = 30 * 24 * 3600 * 1000;
export const MAX_USERS = 5000;
export const POLL_MIN = 2;
export const POLL_MAX = 8;
export const MAX_CHUNKS = 24;
export const MAX_CHUNK_CHARS = 600_000;
const LOG_KEEP = 300;
const FAIL_LIMIT = 6;
const FAIL_WINDOW_MS = 10 * 60 * 1000;

const enc = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const lower = (s) => String(s ?? "").toLowerCase();
const fail = (error, status = 400) => ({ error, status });
const rankOf = (user) => RANKS[user?.role] ?? 0;
const clean = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const validName = (n) => /^[A-Za-z0-9_]{3,16}$/.test(n);
const validDisplay = (n) => /^[\x21-\x7e]{1,16}$/.test(n); // also valid as a Minecraft name
const validColor = (c) => /^#[0-9a-fA-F]{6}$/.test(c);

async function sha256(text) {
    return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function pbkdf2(password, saltHex, iterations) {
    const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

async function hmac(secret, text) {
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

const randomHex = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

// Two strings compared without stopping at the first difference.
async function sameSecret(a, b) {
    const [x, y] = await Promise.all([sha256(`a:${a}`), sha256(`a:${b}`)]);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
    return diff === 0;
}

/** An address with its last part hidden, for the list an admin reads. */
export function maskIp(ip) {
    if (!ip) return "unknown";
    if (ip.includes(":")) return `${ip.split(":").slice(0, 2).join(":")}:*`;
    const p = ip.split(".");
    return p.length === 4 ? `${p[0]}.${p[1]}.*.*` : "unknown";
}

export class Accounts {
    constructor({ store, ownerPassword = "", ipSecret = "", now = () => Date.now(), iterations = 100_000 }) {
        this.store = store;
        this.ownerPassword = ownerPassword;
        this.ipSecret = ipSecret || ownerPassword || "horizon-ip";
        this.now = now;
        this.iterations = iterations;
        this.users = new Map(); // lowercase name -> user
        this.meta = { seq: 0, log: [], announcement: null, shout: null, votes: {} };
        this.bans = {}; // ip hash -> { mask, by, at, actionId }
        this.sessions = new Map(); // token hash -> { user, at }
        this.fails = new Map(); // "ip:name" -> [times]
        this.loaded = false;
    }

    async load() {
        if (this.loaded) return;
        for (const [key, value] of await this.store.list("user:")) this.users.set(key.slice(5), value);
        this.meta = { ...this.meta, ...((await this.store.get("meta")) ?? {}) };
        this.bans = (await this.store.get("bans")) ?? {};
        this.loaded = true;
    }

    saveUser = (u) => this.store.put(`user:${lower(u.name)}`, u);
    saveMeta = () => this.store.put("meta", this.meta);
    saveBans = () => this.store.put("bans", this.bans);

    ipHash = async (ip) => (ip ? (await hmac(this.ipSecret, ip)).slice(0, 32) : "");

    /** The public face of an account: what lists and nametags show. */
    view(u) {
        return {
            name: u.name, // the username: unique
            display: u.display || u.name, // the display name: shown, copyable
            role: u.role,
            skin: u.skin || "",
            nametag: u.role === "owner" ? u.nametag ?? { mode: "rainbow" } : null,
        };
    }

    async ipBanned(ip) {
        await this.load();
        const h = await this.ipHash(ip);
        return Boolean(h && this.bans[h]);
    }

    async session(token) {
        await this.load();
        if (typeof token !== "string" || token.length < 32) return null;
        const key = await sha256(token);
        let s = this.sessions.get(key) ?? (await this.store.get(`sess:${key}`));
        if (!s) return null;
        if (this.now() - s.at > SESSION_MS) {
            this.sessions.delete(key);
            await this.store.delete(`sess:${key}`);
            return null;
        }
        this.sessions.set(key, s);
        return this.users.get(lower(s.user)) ?? null;
    }

    async startSession(user) {
        const token = randomHex(32);
        const key = await sha256(token);
        const s = { user: user.name, at: this.now() };
        this.sessions.set(key, s);
        await this.store.put(`sess:${key}`, s);
        return { token, me: this.view(user) };
    }

    async signup(name, password, ip) {
        await this.load();
        name = clean(name, 16);
        if (!validName(name)) return fail("A username is 3 to 16 letters, numbers or underscores.");
        if (typeof password !== "string" || password.length < 8 || password.length > 128) return fail("A password is 8 to 128 characters.");
        if (lower(name) === lower(OWNER_NAME)) return fail("That username is taken.", 409);
        if (await this.ipBanned(ip)) return fail("This network is banned from the site.", 403);
        if (this.users.has(lower(name))) return fail("That username is taken.", 409);
        if (this.users.size >= MAX_USERS) return fail("No more accounts can be made right now.", 503);
        const salt = randomHex(16);
        const user = {
            name, display: name, salt, iterations: this.iterations, hash: await pbkdf2(password, salt, this.iterations),
            role: "user", skin: "", created: this.now(), banned: false, kickedUntil: 0, ip: "", ipMask: "", data: null,
        };
        this.users.set(lower(name), user);
        await this.saveUser(user);
        await this.noteIp(user, ip);
        return this.startSession(user);
    }

    async login(name, password, ip) {
        await this.load();
        name = clean(name, 16);
        const ipKey = `${await this.ipHash(ip)}:${lower(name)}`;
        const recent = (this.fails.get(ipKey) ?? []).filter((t) => this.now() - t < FAIL_WINDOW_MS);
        if (recent.length >= FAIL_LIMIT) return fail("Too many tries. Wait a few minutes.", 429);
        const wrong = () => {
            recent.push(this.now());
            this.fails.set(ipKey, recent);
            return fail("Wrong username or password.", 401);
        };
        if (typeof password !== "string" || password.length > 128) return wrong();
        const isOwner = lower(name) === lower(OWNER_NAME);
        // A banned network can't log in, except the owner (so a mistake can be undone).
        if (!isOwner && (await this.ipBanned(ip))) return fail("This network is banned from the site.", 403);
        if (isOwner) {
            if (!this.ownerPassword) return fail("The owner login isn't set up on this server (set the ADMIN_PASSWORD secret).", 503);
            if (!(await sameSecret(password, this.ownerPassword))) return wrong();
            let owner = this.users.get(lower(OWNER_NAME));
            if (!owner) {
                owner = { name: OWNER_NAME, display: OWNER_NAME, role: "owner", skin: "", created: this.now(), banned: false, kickedUntil: 0, ip: "", ipMask: "", data: null, nametag: { mode: "rainbow" } };
                this.users.set(lower(OWNER_NAME), owner);
                await this.saveUser(owner);
            }
            this.fails.delete(ipKey);
            await this.noteIp(owner, ip);
            return this.startSession(owner);
        }
        const user = this.users.get(lower(name));
        // Hash anyway when the name is unknown, so timing doesn't reveal which names exist.
        const salt = user?.salt ?? "00".repeat(16);
        const got = await pbkdf2(password, salt, user?.iterations ?? this.iterations);
        if (!user || !(await sameSecret(got, user.hash))) return wrong();
        this.fails.delete(ipKey);
        await this.noteIp(user, ip);
        return this.startSession(user);
    }

    async logout(token) {
        await this.load();
        if (typeof token !== "string") return {};
        const key = await sha256(token);
        this.sessions.delete(key);
        await this.store.delete(`sess:${key}`);
        return {};
    }

    async noteIp(user, ip) {
        const h = await this.ipHash(ip);
        if (!h || user.ip === h) return;
        user.ip = h;
        user.ipMask = maskIp(ip);
        await this.saveUser(user);
    }

    // ---- profile

    async setSkin(token, skin) {
        const user = await this.session(token);
        if (!user) return fail("Log in first.", 401);
        user.skin = clean(skin, 32).replace(/[^\w .-]/g, "");
        await this.saveUser(user);
        return { me: this.view(user) };
    }

    async setDisplay(token, display) {
        const user = await this.session(token);
        if (!user) return fail("Log in first.", 401);
        display = typeof display === "string" ? display.trim() : "";
        if (!validDisplay(display)) return fail("A display name is 1 to 16 characters, with no spaces.");
        user.display = display;
        await this.saveUser(user);
        return { me: this.view(user) };
    }

    async setNametag(token, mode, color) {
        const user = await this.session(token);
        if (rankOf(user) < RANKS.owner) return fail("Only the owner has a nametag.", 403);
        if (mode === "color" && !validColor(color)) return fail("Pick a color like #ff8a1f.");
        if (!["rainbow", "color", "none"].includes(mode)) return fail("Unknown nametag.");
        user.nametag = mode === "color" ? { mode, color: color.toLowerCase() } : { mode };
        await this.saveUser(user);
        return { me: this.view(user) };
    }

    // ---- staff

    async staff(token, need) {
        const user = await this.session(token);
        if (!user) return [null, fail("Log in first.", 401)];
        if (rankOf(user) < RANKS[need]) return [null, fail("You can't do that.", 403)];
        return [user, null];
    }

    async search(token, query) {
        const [actor, err] = await this.staff(token, "mod");
        if (err) return err;
        const q = lower(clean(query, 16));
        const out = [];
        for (const u of this.users.values()) {
            if (q && !lower(u.name).includes(q) && !lower(u.display).includes(q) && !lower(u.skin).includes(q)) continue;
            out.push({
                ...this.view(u), banned: u.banned, kickedUntil: u.kickedUntil > this.now() ? u.kickedUntil : 0,
                ipBanned: Boolean(u.ip && this.bans[u.ip]), canAct: rankOf(u) < rankOf(actor),
            });
            if (out.length >= 30) break;
        }
        out.sort((a, b) => a.name.localeCompare(b.name));
        return { users: out };
    }

    record(entry) {
        const action = { id: ++this.meta.seq, at: this.now(), undone: null, ...entry };
        this.meta.log.push(action);
        if (this.meta.log.length > LOG_KEEP) this.meta.log.splice(0, this.meta.log.length - LOG_KEEP);
        return action;
    }

    async target(actor, name) {
        const t = this.users.get(lower(clean(name, 16)));
        if (!t) return [null, fail("No such player.", 404)];
        if (t === actor) return [null, fail("You can't do that to yourself.", 400)];
        if (rankOf(t) >= rankOf(actor)) return [null, fail("That player outranks you.", 403)];
        return [t, null];
    }

    async setRole(token, name, role) {
        const [owner, err] = await this.staff(token, "owner");
        if (err) return err;
        if (!ASSIGNABLE.includes(role)) return fail("Unknown role.");
        const [t, bad] = await this.target(owner, name);
        if (bad) return bad;
        if (t.role === role) return fail(`${t.name} is already ${role}.`);
        const action = this.record({ type: "role", by: owner.name, target: t.name, from: t.role, to: role });
        t.role = role;
        await Promise.all([this.saveUser(t), this.saveMeta()]);
        return { action, user: this.view(t) };
    }

    async kick(token, name) {
        const [actor, err] = await this.staff(token, "mod");
        if (err) return err;
        const [t, bad] = await this.target(actor, name);
        if (bad) return bad;
        const action = this.record({ type: "kick", by: actor.name, target: t.name, prev: t.kickedUntil });
        t.kickedUntil = this.now() + KICK_MS;
        await Promise.all([this.saveUser(t), this.saveMeta()]);
        return { action };
    }

    async ban(token, name) {
        const [actor, err] = await this.staff(token, "janitor");
        if (err) return err;
        const [t, bad] = await this.target(actor, name);
        if (bad) return bad;
        if (t.banned) return fail(`${t.name} is already banned.`);
        const action = this.record({ type: "ban", by: actor.name, target: t.name });
        t.banned = true;
        await Promise.all([this.saveUser(t), this.saveMeta()]);
        return { action };
    }

    async ipBan(token, name) {
        const [actor, err] = await this.staff(token, "admin");
        if (err) return err;
        const [t, bad] = await this.target(actor, name);
        if (bad) return bad;
        if (!t.ip) return fail(`${t.name}'s network isn't known yet (they haven't been online).`);
        if (t.ip === actor.ip) return fail("That is your own network.");
        if (this.bans[t.ip]) return fail("That network is already banned.");
        const action = this.record({ type: "ipban", by: actor.name, target: t.name, ip: t.ip, mask: t.ipMask });
        this.bans[t.ip] = { mask: t.ipMask, by: actor.name, at: this.now(), target: t.name, actionId: action.id };
        await Promise.all([this.saveBans(), this.saveMeta()]);
        return { action };
    }

    async ipBans(token) {
        const [, err] = await this.staff(token, "admin");
        if (err) return err;
        return { bans: Object.entries(this.bans).map(([id, b]) => ({ id, ...b })).sort((a, b) => b.at - a.at) };
    }

    async unbanIp(token, id) {
        const [actor, err] = await this.staff(token, "admin");
        if (err) return err;
        const ban = this.bans[id];
        if (!ban) return fail("That ban is gone already.", 404);
        const action = this.record({ type: "unipban", by: actor.name, target: ban.target, ip: id, mask: ban.mask, ban });
        delete this.bans[id];
        await Promise.all([this.saveBans(), this.saveMeta()]);
        return { action };
    }

    // The least rank that may undo each kind of action.
    static NEED = { kick: "mod", ban: "janitor", ipban: "admin", unipban: "admin", role: "owner" };

    canUndo(actor, a) {
        if (a.undone || !actor) return false;
        const need = RANKS[Accounts.NEED[a.type]];
        const by = this.users.get(lower(a.by));
        return rankOf(actor) >= need && (rankOf(actor) >= RANKS.owner || rankOf(actor) >= rankOf(by));
    }

    async log(token) {
        const [actor, err] = await this.staff(token, "mod");
        if (err) return err;
        const actions = [...this.meta.log].reverse().slice(0, 100).map(({ prev, ban, ip, ...a }) => ({ ...a, canUndo: this.canUndo(actor, { ...a, ip }) }));
        return { actions };
    }

    async undo(token, id) {
        const [actor, err] = await this.staff(token, "mod");
        if (err) return err;
        const a = this.meta.log.find((x) => x.id === Number(id));
        if (!a) return fail("That action is no longer in the log.", 404);
        if (a.undone) return fail("Already undone.");
        if (!this.canUndo(actor, a)) return fail("You can't undo that one.", 403);
        const t = this.users.get(lower(a.target));
        if (a.type === "kick" && t) t.kickedUntil = a.prev > this.now() ? a.prev : 0;
        else if (a.type === "ban" && t) t.banned = false;
        else if (a.type === "role" && t) t.role = a.from;
        else if (a.type === "ipban") delete this.bans[a.ip];
        else if (a.type === "unipban") this.bans[a.ip] = a.ban;
        a.undone = { by: actor.name, at: this.now() };
        await Promise.all([t ? this.saveUser(t) : null, this.saveBans(), this.saveMeta()]);
        return { action: { ...a, ban: undefined, prev: undefined } };
    }

    // ---- the owner's announcements and shout

    async setNotice(token, field, text, options) {
        const [owner, err] = await this.staff(token, "owner");
        if (err) return err;
        const max = field === "announcement" ? 500 : 300;
        text = clean(text, max);
        let poll;
        if (field === "shout" && text && Array.isArray(options)) {
            const list = options.map((o) => clean(o, 60)).filter(Boolean);
            if (list.length === 1) return fail(`A poll needs at least ${POLL_MIN} options.`);
            if (list.length > POLL_MAX) return fail(`A poll has at most ${POLL_MAX} options.`);
            if (new Set(list.map(lower)).size !== list.length) return fail("Two options are the same.");
            if (list.length) poll = { options: list };
        }
        if (text) this.meta[field] = { id: ++this.meta.seq, text, by: owner.name, at: this.now(), ...(poll ? { poll } : {}) };
        else this.meta[field] = null;
        // A new shout starts with no votes; deleting it clears them.
        if (field === "shout") this.meta.votes = {};
        await this.saveMeta();
        return { [field]: field === "shout" ? this.shoutFor(owner) : this.meta[field] };
    }

    /** The shout as one player sees it: poll results, and which option they picked. */
    shoutFor(user) {
        const shout = this.meta.shout;
        if (!shout?.poll) return shout;
        const counts = shout.poll.options.map(() => 0);
        for (const v of Object.values(this.meta.votes ?? {})) if (counts[v] !== undefined) counts[v]++;
        const mine = user ? this.meta.votes?.[lower(user.name)] : undefined;
        return {
            ...shout,
            poll: {
                options: shout.poll.options.map((text, i) => ({ text, votes: counts[i] })),
                total: counts.reduce((a, b) => a + b, 0),
                mine: mine ?? null,
            },
        };
    }

    async vote(token, option) {
        const user = await this.session(token);
        if (!user) return fail("Log in to vote.", 401);
        const poll = this.meta.shout?.poll;
        if (!poll) return fail("There is no poll right now.", 404);
        if (!Number.isInteger(option) || option < 0 || option >= poll.options.length) return fail("Pick one of the options.");
        // One vote per account; voting again changes it.
        this.meta.votes[lower(user.name)] = option;
        await this.saveMeta();
        return { shout: this.shoutFor(user) };
    }

    /** What every page hears on its presence ping. */
    async ping(token, ip) {
        await this.load();
        const user = await this.session(token);
        if (user) await this.noteIp(user, ip);
        const now = this.now();
        return {
            ...this.site(user),
            me: user ? { ...this.view(user), canStaff: rankOf(user) >= RANKS.mod } : null,
            status: {
                banned: Boolean(user?.banned),
                kickedUntil: user && user.kickedUntil > now ? user.kickedUntil : 0,
                ipBanned: await this.ipBanned(ip),
            },
        };
    }

    site(user = null) {
        const owner = this.users.get(lower(OWNER_NAME));
        // The owner's face, so a page can draw "from Zeb" in the nametag they picked.
        return { announcement: this.meta.announcement, shout: this.shoutFor(user), owner: owner ? this.view(owner) : null };
    }

    // ---- cloud save: a bundle the page makes, kept in chunks

    async putData(token, gen, index, total, chunk) {
        const user = await this.session(token);
        if (!user) return fail("Log in first.", 401);
        if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > MAX_CHUNKS || index < 0 || index >= total) return fail("Bad chunk.");
        if (typeof chunk !== "string" || chunk.length > MAX_CHUNK_CHARS) return fail("Chunk too large.", 413);
        gen = clean(gen, 24).replace(/[^\w]/g, "");
        if (!gen) return fail("Bad chunk.");
        const l = lower(user.name);
        await this.store.put(`data:${l}:${gen}:${index}`, chunk);
        if (index === total - 1) {
            const old = user.data;
            user.data = { gen, chunks: total, at: this.now() };
            await this.saveUser(user);
            if (old && old.gen !== gen) for (let i = 0; i < old.chunks; i++) await this.store.delete(`data:${l}:${old.gen}:${i}`);
        }
        return {};
    }

    async dataInfo(token) {
        const user = await this.session(token);
        if (!user) return fail("Log in first.", 401);
        return { data: user.data };
    }

    async getData(token, index) {
        const user = await this.session(token);
        if (!user) return fail("Log in first.", 401);
        if (!user.data) return fail("Nothing saved yet.", 404);
        if (!Number.isInteger(index) || index < 0 || index >= user.data.chunks) return fail("Bad chunk.");
        return { chunk: await this.store.get(`data:${lower(user.name)}:${user.data.gen}:${index}`) };
    }

    async deleteData(token) {
        const user = await this.session(token);
        if (!user) return fail("Log in first.", 401);
        const l = lower(user.name);
        if (user.data) for (let i = 0; i < user.data.chunks; i++) await this.store.delete(`data:${l}:${user.data.gen}:${i}`);
        user.data = null;
        await this.saveUser(user);
        return {};
    }

    /** A request's path and parsed body to the right method: [status, json]. */
    async handle(method, path, body, ip) {
        await this.load();
        const done = (r) => (r?.error ? [r.status ?? 400, { error: r.error }] : [200, r ?? {}]);
        if (method === "GET" && path === "/api/site") return [200, this.site()];
        if (method !== "POST") return [404, { error: "not found" }];
        const b = body ?? {};
        const t = b.token;
        switch (path) {
            case "/api/account/signup": return done(await this.signup(b.name, b.password, ip));
            case "/api/account/login": return done(await this.login(b.name, b.password, ip));
            case "/api/account/logout": return done(await this.logout(t));
            case "/api/account/me": {
                const u = await this.session(t);
                return u ? [200, { me: this.view(u), data: u.data }] : [401, { error: "Log in first." }];
            }
            case "/api/account/skin": return done(await this.setSkin(t, b.skin));
            case "/api/account/display": return done(await this.setDisplay(t, b.display));
            case "/api/poll/vote": return done(await this.vote(t, b.option));
            case "/api/account/nametag": return done(await this.setNametag(t, b.mode, b.color));
            case "/api/staff/search": return done(await this.search(t, b.q));
            case "/api/staff/role": return done(await this.setRole(t, b.name, b.role));
            case "/api/staff/kick": return done(await this.kick(t, b.name));
            case "/api/staff/ban": return done(await this.ban(t, b.name));
            case "/api/staff/ipban": return done(await this.ipBan(t, b.name));
            case "/api/staff/ipbans": return done(await this.ipBans(t));
            case "/api/staff/unipban": return done(await this.unbanIp(t, b.id));
            case "/api/staff/log": return done(await this.log(t));
            case "/api/staff/undo": return done(await this.undo(t, b.id));
            case "/api/owner/announce": return done(await this.setNotice(t, "announcement", b.text));
            case "/api/owner/shout": return done(await this.setNotice(t, "shout", b.text, b.options));
            case "/api/data/put": return done(await this.putData(t, b.gen, b.index, b.total, b.chunk));
            case "/api/data/info": return done(await this.dataInfo(t));
            case "/api/data/get": return done(await this.getData(t, b.index));
            case "/api/data/delete": return done(await this.deleteData(t));
            default: return [404, { error: "not found" }];
        }
    }
}

/** A store held in memory, for tests. */
export class MemoryStore {
    map = new Map();
    get = async (k) => structuredClone(this.map.get(k));
    put = async (k, v) => void this.map.set(k, structuredClone(v));
    delete = async (k) => void this.map.delete(k);
    list = async (prefix) => [...this.map].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)]);
}
