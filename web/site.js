// What both pages do with what the presence ping hears (presence.js):
//  - an announcement from the owner pops up once as a dialog (notice.js);
//  - a banned network sees a block screen;
//  - a banned or kicked account can't play: the game page closes and goes back
//    to the launcher, which refuses Launch and Join until the kick runs out or
//    is lifted.
// watchSite({ game: true }) is the game page's: there it leaves instead of waiting.
import { api, loggedIn } from "./account.js";
import { nametag, renderPoll, richText, showNotice } from "./notice.js";
import { refreshSite } from "./presence.js";

const SEEN = "horizon-seen-notice";
const FLASH = "horizon-flash";
const safe = (fn, fallback) => {
    try {
        return fn();
    } catch {
        return fallback;
    }
};

export const MESSAGES = {
    ip: "This network is banned from z's horizon.",
    banned: "Your account is banned from playing. If you think that's a mistake, ask a staff member.",
    kicked: (until) => `You were kicked. You can play again at ${new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`,
};

/** A message left by the page that sent the player away, shown once here. */
export function takeFlash() {
    return safe(() => {
        const text = sessionStorage.getItem(FLASH);
        sessionStorage.removeItem(FLASH);
        return text;
    }, null);
}

/** The owner's own announcement doesn't pop up for them. */
export const markSeen = (id) => safe(() => localStorage.setItem(SEEN, String(id)));

export const blockedReason = () => document.documentElement.dataset.blocked || "";

const OVERLAY_CSS = `
.zh-shout { position: fixed; z-index: 2147482000; top: 10px; left: 50%; transform: translateX(-50%); width: min(420px, 92vw); padding: 10px 14px 12px;
  border-radius: 14px; color: #f4ecff; font: 14px/1.4 ui-rounded, "Ubuntu", system-ui, -apple-system, "Segoe UI", sans-serif; border: 1px solid transparent;
  background-image: linear-gradient(rgba(21, 11, 37, .92), rgba(13, 7, 25, .92)), linear-gradient(135deg, #b44cff, #ff8a1f); background-origin: border-box;
  background-clip: padding-box, border-box; box-shadow: 0 8px 30px rgba(0, 0, 0, .4); }
.zh-shout[hidden] { display: none; }
.zh-shout header { display: flex; align-items: center; gap: 8px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #a99bc4; }
.zh-shout header b { flex: 1; }
.zh-shout header button { background: none; border: 0; color: #a99bc4; cursor: pointer; font-size: 18px; line-height: 1; }
.zh-shout p { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.zh-shout .zh-hint { margin: 8px 0 0; font-size: 12px; color: #a99bc4; }
`;

/** The game page's copy of the shout (and its poll): a small box at the top. */
function gameShout() {
    let box = null;
    let dismissed = null;
    return (site) => {
        const shout = site?.shout;
        if (!shout || shout.id === dismissed) {
            if (box) box.hidden = true;
            return;
        }
        if (!box) {
            const css = document.createElement("style");
            css.textContent = OVERLAY_CSS;
            document.head.append(css);
            box = document.createElement("div");
            box.className = "zh-shout";
            box.setAttribute("role", "status");
            document.body.append(box);
        }
        box.hidden = false;
        box.replaceChildren();
        const head = document.createElement("header");
        const who = document.createElement("b");
        who.append(document.createTextNode("Shout from "));
        const name = document.createElement("span");
        nametag(name, site.owner?.display ?? shout.by, site.owner?.nametag);
        who.append(name);
        const close = document.createElement("button");
        close.type = "button";
        close.setAttribute("aria-label", "close");
        close.textContent = "×";
        close.addEventListener("click", () => {
            dismissed = shout.id;
            box.hidden = true;
        });
        head.append(who, close);
        const text = document.createElement("p");
        richText(text, shout.text);
        const poll = document.createElement("div");
        box.append(head, text, poll);
        if (shout.poll) {
            renderPoll(poll, shout, {
                loggedIn: loggedIn(),
                loginHref: (safe(() => sessionStorage.getItem("horizon-return"), "") || "index.html").split("#")[0] + "#account",
                vote: async (option) => {
                    try {
                        await api("/api/poll/vote", { option });
                    } catch {}
                    refreshSite();
                },
            });
            const hint = document.createElement("p");
            hint.className = "zh-hint";
            hint.textContent = "Press Esc to free the mouse, then click an option to vote.";
            box.append(hint);
        }
    };
}

const REFRESH_CSS = `
.zh-refresh { position: fixed; z-index: 2147482100; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
  max-width: min(560px, 94vw); padding: 8px 10px 8px 14px; border-radius: 999px; color: #f4ecff; border: 1px solid transparent;
  font: 14px/1.35 ui-rounded, "Ubuntu", system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 8px 30px rgba(0, 0, 0, .45);
  background-image: linear-gradient(rgba(21, 11, 37, .95), rgba(13, 7, 25, .95)), linear-gradient(135deg, #b44cff, #ff8a1f); background-origin: border-box; background-clip: padding-box, border-box; }
.zh-refresh[hidden] { display: none; }
.zh-refresh .zh-rtext { min-width: 0; overflow-wrap: anywhere; }
.zh-refresh .zh-rtext small { display: block; color: #a99bc4; font-size: 12px; }
.zh-refresh time { font-variant-numeric: tabular-nums; font-weight: 700; color: #ffd23f; white-space: nowrap; }
.zh-refresh button { flex: none; cursor: pointer; color: #f4ecff; background: rgba(180, 76, 255, .22); border: 1px solid rgba(180, 76, 255, .5); border-radius: 999px; padding: 4px 10px; font: inherit; font-size: 12px; }
.zh-refresh button:hover, .zh-refresh button:focus-visible { background: rgba(180, 76, 255, .4); outline: none; }
.zh-refresh.zh-mini { padding: 5px 6px 5px 12px; font-size: 12px; }
.zh-refresh.zh-mini .zh-rtext small { display: none; }
`;
const HIDDEN = "horizon-refresh-hidden";
const DONE = "horizon-refreshed"; // per tab (sessionStorage): every open tab reloads once

/** "1:05", "12:30:00" or "2d 3h" for a number of milliseconds. */
export function clock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const d = Math.floor(s / 86400);
    if (d) return `${d}d ${Math.floor((s % 86400) / 3600)}h`;
    const h = Math.floor(s / 3600);
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${m}:${sec}` : `${Number(m)}:${sec}`;
}

/**
 * The owner's scheduled refresh: a live countdown (with the owner's message when there is one) that a
 * player can hide, leaving a small timer they can open again, and the reload itself. A page reloads
 * once per refresh, and only if it was open before the time came, so nobody who arrives later is bounced.
 * The game page only takes part when the owner chose to include games.
 */
function refreshWatcher({ game }) {
    let box = null;
    let shown = null; // the refresh being counted down
    let offset = 0; // server clock minus this page's
    let firstServerNow = null;
    let timer = 0;
    const tick = () => {
        if (!shown || !box) return;
        const left = shown.at - (Date.now() + offset);
        const time = box.querySelector("time");
        time.textContent = left > 0 ? clock(left) : "now";
        box.querySelector(".zh-rtext b").textContent = left > 0 ? "Page refreshes in " : "Refreshing";
        if (left <= 0) {
            time.textContent = "";
            if (!safe(() => sessionStorage.getItem(DONE) === String(shown.id), false)) {
                safe(() => sessionStorage.setItem(DONE, String(shown.id)));
                globalThis.horizonNoLeavePrompt = true;
                clearInterval(timer);
                setTimeout(() => location.reload(), 600);
            }
        }
    };
    const build = () => {
        const css = document.createElement("style");
        css.textContent = REFRESH_CSS;
        document.head.append(css);
        box = document.createElement("div");
        box.className = "zh-refresh";
        box.setAttribute("role", "status");
        const text = document.createElement("div");
        text.className = "zh-rtext";
        const line = document.createElement("span");
        const b = document.createElement("b");
        b.style.fontWeight = "600";
        line.append(b, document.createElement("time"));
        const note = document.createElement("small");
        text.append(line, note);
        const button = document.createElement("button");
        button.type = "button";
        button.addEventListener("click", () => {
            const hidden = box.classList.toggle("zh-mini");
            safe(() => localStorage.setItem(HIDDEN, hidden ? String(shown.id) : ""));
            button.textContent = hidden ? "Show" : "Hide";
            button.title = hidden ? "Show the message" : "Make this small";
        });
        box.append(text, button);
        document.body.append(box);
    };
    return (site) => {
        const refresh = site?.refresh ?? null;
        if (Number.isFinite(site?.now)) offset = site.now - Date.now();
        if (firstServerNow === null && Number.isFinite(site?.now)) firstServerNow = site.now;
        // Not this page's to act on: gone, or the game page when games aren't included.
        if (!refresh || (game && !refresh.game)) {
            shown = null;
            if (box) box.hidden = true;
            clearInterval(timer);
            return;
        }
        // A page that opened after the time passed was never asked to refresh.
        if (firstServerNow >= refresh.at && !safe(() => sessionStorage.getItem(DONE) === String(refresh.id), false)) {
            safe(() => sessionStorage.setItem(DONE, String(refresh.id)));
        }
        if (safe(() => sessionStorage.getItem(DONE) === String(refresh.id), false) && refresh.at <= site.now) {
            shown = null;
            if (box) box.hidden = true;
            return;
        }
        if (!box) build();
        if (!shown || shown.id !== refresh.id) {
            shown = refresh;
            const mini = safe(() => localStorage.getItem(HIDDEN), "") === String(refresh.id);
            box.classList.toggle("zh-mini", mini);
            const button = box.querySelector("button");
            button.textContent = mini ? "Show" : "Hide";
            button.title = mini ? "Show the message" : "Make this small";
        }
        shown = refresh;
        const note = box.querySelector("small");
        note.replaceChildren();
        if (refresh.text) richText(note, refresh.text);
        note.hidden = !refresh.text;
        box.hidden = false;
        clearInterval(timer);
        tick();
        timer = setInterval(tick, 250);
    };
}

export function watchSite({ game = false } = {}) {
    let leaving = false;
    const drawShout = game ? gameShout() : null;
    const drawRefresh = refreshWatcher({ game });
    document.addEventListener("horizon:site", (event) => {
        const site = event.detail;
        if (!site) return;
        const { status, announcement } = site;
        drawShout?.(site);
        drawRefresh(site);
        const reason = status.ipBanned ? "ip" : status.banned ? "banned" : status.kickedUntil ? "kicked" : "";
        document.documentElement.dataset.blocked = reason;

        if (reason && game && !leaving) {
            leaving = true;
            const text = reason === "kicked" ? MESSAGES.kicked(status.kickedUntil) : MESSAGES[reason];
            safe(() => sessionStorage.setItem(FLASH, text));
            const back = safe(() => sessionStorage.getItem("horizon-return"), "") || "index.html";
            globalThis.horizonNoLeavePrompt = true;
            location.replace(back);
            return;
        }
        if (announcement && !reason) {
            const seen = safe(() => localStorage.getItem(SEEN), "");
            if (String(announcement.id) !== seen) {
                safe(() => localStorage.setItem(SEEN, String(announcement.id)));
                showNotice({ title: "Notice", text: announcement.text, by: site.owner ?? { name: announcement.by } });
            }
        }
    });
}
