// What both pages do with what the presence ping hears (presence.js):
//  - an announcement from the owner pops up once as a dialog (notice.js);
//  - a banned network sees a block screen;
//  - a banned or kicked account can't play: the game page closes and goes back
//    to the launcher, which refuses Launch and Join until the kick runs out or
//    is lifted.
// watchSite({ game: true }) is the game page's: there it leaves instead of waiting.
import { showNotice } from "./notice.js";

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

export function watchSite({ game = false } = {}) {
    let leaving = false;
    document.addEventListener("horizon:site", (event) => {
        const site = event.detail;
        if (!site) return;
        const { status, announcement } = site;
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
