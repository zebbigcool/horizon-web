// Unread and ping tracking for the Chat tab, straight from the Stoat/Revolt server (CHAT_URL), so the chat
// site itself needs no change. The player signs in to the chat once (Settings); the launcher keeps its own
// session, listens on the chat's WebSocket like any client, and works out what is unread from the same
// data the chat uses: each channel's last message, what you have read (acks, also from the open chat tab),
// and the messages that mention you. Muted servers and channels are respected. Only a session token is kept.
import { CHAT_URL } from "./config.js";

const KEY = "horizon-chat-session";
const API = `${CHAT_URL.replace(/\/$/, "")}/api`;
const READABLE = new Set(["TextChannel", "DirectMessage", "Group"]);
const safe = (fn, fallback) => {
    try {
        return fn();
    } catch {
        return fallback;
    }
};

const loadSession = () => safe(() => JSON.parse(localStorage.getItem(KEY) ?? "null"), null);
const saveSession = (s) => safe(() => (s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY)));

/** The notification level of a channel: "all", "mention", or "none" (muted). */
export function levelOf(settings, channel) {
    const norm = (v) => (v === "muted" || v === "none" ? "none" : v === "mention" ? "mention" : "all");
    if (channel.channel_type === "DirectMessage" || channel.channel_type === "Group") return norm(settings.channel?.[channel._id]);
    return norm(settings.channel?.[channel._id] ?? settings.server?.[channel.server]);
}

/** What the unread dot should show from the chat's data: { unread: channels, pinged }. */
export function summarize({ channels, acks, settings }) {
    let unread = 0;
    let pinged = false;
    for (const channel of channels.values()) {
        const level = levelOf(settings, channel);
        if (level === "none") continue;
        const ack = acks.get(channel._id);
        if (ack?.mentions.size) pinged = true;
        if (level === "all" && channel.last_message_id && (!ack || ack.last_id < channel.last_message_id)) unread++;
    }
    return { unread, pinged };
}

const parseSettings = (raw) => safe(() => JSON.parse(raw?.[1] ?? "{}"), {});

export function createChatWatcher(onChange) {
    let socket = null;
    let timer = 0;
    let ping = 0;
    let wait = 3000;
    let state = null;
    let status = "off"; // off | connecting | on | error
    let detail = "";
    const emit = () => onChange({ ...(state ? summarize(state) : { unread: 0, pinged: false }), status, detail, signedIn: Boolean(loadSession()) });
    const setStatus = (s, d = "") => {
        status = s;
        detail = d;
        emit();
    };

    function onEvent(event, me) {
        switch (event.type) {
            case "Authenticated":
                break;
            case "Ready": {
                const channels = new Map();
                for (const c of event.channels ?? []) if (READABLE.has(c.channel_type)) channels.set(c._id, c);
                const acks = new Map();
                for (const u of event.channel_unreads ?? []) acks.set(u._id.channel, { last_id: u.last_id ?? "", mentions: new Set(u.mentions ?? []) });
                state = { channels, acks, settings: parseSettings(event.user_settings?.notifications), me };
                wait = 3000;
                setStatus("on");
                break;
            }
            case "Message": {
                if (!state || event.author === me) break;
                const channel = state.channels.get(event.channel);
                if (!channel) break;
                channel.last_message_id = event._id;
                if (event.mentions?.includes(me)) {
                    const ack = state.acks.get(event.channel) ?? { last_id: "", mentions: new Set() };
                    ack.mentions.add(event._id);
                    state.acks.set(event.channel, ack);
                }
                emit();
                break;
            }
            case "ChannelAck": {
                if (!state || event.user !== me) break;
                const ack = state.acks.get(event.id) ?? { last_id: "", mentions: new Set() };
                if (event.message_id > ack.last_id) ack.last_id = event.message_id;
                for (const id of [...ack.mentions]) if (id <= ack.last_id) ack.mentions.delete(id);
                state.acks.set(event.id, ack);
                emit();
                break;
            }
            case "ChannelCreate":
                if (state && READABLE.has(event.channel_type)) state.channels.set(event._id, event);
                emit();
                break;
            case "ChannelDelete":
                state?.channels.delete(event.id);
                emit();
                break;
            case "ServerDelete":
                if (state) for (const [id, c] of state.channels) if (c.server === event.id) state.channels.delete(id);
                emit();
                break;
            case "UserSettingsUpdate":
                if (state && event.update?.notifications) {
                    state.settings = parseSettings(event.update.notifications);
                    emit();
                }
                break;
            case "Error":
                if (event.error === "InvalidSession" || event.error === "Unauthorized") {
                    saveSession(null);
                    stop();
                    setStatus("error", "The chat signed this session out. Sign in again.");
                }
                break;
            default:
        }
    }

    async function open() {
        const session = loadSession();
        if (!session) return;
        setStatus("connecting");
        let url;
        try {
            const root = await (await fetch(API)).json();
            url = `${root.ws ?? `wss://${new URL(CHAT_URL).host}/ws`}?version=1&format=json`;
        } catch {
            url = `${CHAT_URL.replace(/^http/, "ws").replace(/\/$/, "")}/ws?version=1&format=json`;
        }
        const ws = new WebSocket(url);
        socket = ws;
        ws.onopen = () => {
            ws.send(JSON.stringify({ type: "Authenticate", token: session.token }));
            clearInterval(ping);
            ping = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: "Ping", data: Date.now() })), 25_000);
        };
        ws.onmessage = (m) => {
            const event = safe(() => JSON.parse(m.data), null);
            if (event) onEvent(event, session.userId);
        };
        ws.onclose = () => {
            clearInterval(ping);
            if (socket !== ws) return; // closed on purpose
            socket = null;
            state = null;
            if (!loadSession()) return;
            setStatus("connecting", "Reconnecting…");
            timer = setTimeout(open, wait);
            wait = Math.min(wait * 2, 60_000);
        };
        ws.onerror = () => {};
    }

    function stop() {
        clearTimeout(timer);
        clearInterval(ping);
        const ws = socket;
        socket = null;
        state = null;
        ws?.close();
    }

    return {
        /** Connects with the saved session, if there is one. */
        start() {
            if (!socket && loadSession()) open();
            else emit();
        },
        /** Signs in to the chat. Resolves when connected; rejects with a message to show. */
        async signIn(email, password) {
            let response;
            try {
                response = await fetch(`${API}/auth/session/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password, friendly_name: "z's horizon" }),
                });
            } catch {
                throw new Error("Couldn't reach the chat server.");
            }
            const data = await response.json().catch(() => ({}));
            if (data.result === "MFA") throw new Error("This account uses two-factor sign-in, which isn't supported here yet.");
            if (data.result === "Disabled") throw new Error("That account is disabled.");
            if (!response.ok || !data.token) throw new Error(data.type === "InvalidCredentials" ? "Wrong email or password." : "The chat refused that sign-in.");
            stop();
            saveSession({ token: data.token, userId: data.user_id, sessionId: data._id });
            open();
        },
        /** Signs this session out and forgets it. */
        async signOut() {
            const session = loadSession();
            stop();
            saveSession(null);
            if (session) fetch(`${API}/auth/session/logout`, { method: "POST", headers: { "x-session-token": session.token } }).catch(() => {});
            status = "off";
            detail = "";
            emit();
        },
    };
}
