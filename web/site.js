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

export function watchSite({ game = false } = {}) {
    let leaving = false;
    const drawShout = game ? gameShout() : null;
    document.addEventListener("horizon:site", (event) => {
        const site = event.detail;
        if (!site) return;
        const { status, announcement } = site;
        drawShout?.(site);
        const reason = status.ipBanned ? "ip" : status.banned ? "banned" : status.kickedUntil ? "kicked" : "";
        document.documentElement.dataset.blocked = reason;

        if (reason && game && !leaving) {
            leaving = true;
            const text = reason === "kicked" ? MESSAGES.kicked(status.kickedUntil) : MESSAGES[reason];
            safe(() => sessionStorage.setItem(FLASH, text));
            const back = safe(() => sessionStorage.getItem("horizon-return"), "") || "index.html";
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
