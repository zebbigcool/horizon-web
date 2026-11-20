// Rich text and the notice dialog, for both pages (they carry their own styles).
//  - richText(el, text): "$r$like this$r$" turns the text between the markers
//    into a moving rainbow.
//  - nametag(el, account): a name drawn the way its owner picked (rainbow or a color).
//  - showNotice({ title, text, by }): the dialog announcements use; they queue.
const CSS = `
.zh-rb { background: linear-gradient(90deg, #ff3d6e, #ff8a1f, #ffd23f, #3dff8a, #3db8ff, #b44cff, #ff3d6e); background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; animation: zh-rb 3s linear infinite; }
@keyframes zh-rb { to { background-position: 200% 0; } }
.zh-notice { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; padding: 16px; background: rgba(6, 3, 12, .62);
  backdrop-filter: blur(4px); font: 15px/1.5 ui-rounded, "Ubuntu", system-ui, -apple-system, "Segoe UI", sans-serif; color: #f4ecff; }
.zh-notice[hidden] { display: none; }
.zh-card { width: min(460px, 100%); padding: 18px 20px 16px; border-radius: 16px; background: #130a21; border: 1px solid transparent;
  background-image: linear-gradient(#150b25, #0d0719), linear-gradient(135deg, #b44cff, #ff8a1f);
  background-origin: border-box; background-clip: padding-box, border-box; box-shadow: 0 18px 60px rgba(180, 76, 255, .35); }
.zh-card h3 { margin: 0 0 10px; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #a99bc4; }
.zh-card p { margin: 0 0 18px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 16px; }
.zh-card .zh-foot { display: flex; justify-content: flex-end; }
.zh-card button { min-width: 92px; padding: 8px 22px; cursor: pointer; color: #f4ecff; font: inherit; font-weight: 700; border-radius: 9px; border: 1px solid transparent;
  background-image: linear-gradient(#1a1030, #1a1030), linear-gradient(90deg, #b44cff, #ffd23f, #b44cff); background-origin: border-box; background-clip: padding-box, border-box; }
.zh-card button:hover, .zh-card button:focus-visible { outline: none; color: #ffd23f; }
.zh-poll { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.zh-opt { position: relative; overflow: hidden; display: flex; justify-content: space-between; gap: 12px; text-align: left; padding: 7px 11px; cursor: pointer;
  font: inherit; color: var(--text, #f4ecff); background: var(--ctl, rgba(10, 6, 18, .5)); border: 1px solid var(--line, rgba(180, 76, 255, .45)); border-radius: 8px; }
.zh-opt i { position: absolute; inset: 0 auto 0 0; width: var(--pct, 0%); background: linear-gradient(90deg, rgba(180, 76, 255, .5), rgba(255, 138, 31, .5)); transition: width .4s; }
.zh-opt span { position: relative; overflow-wrap: anywhere; }
.zh-opt:hover { border-color: #ff8a1f; }
.zh-opt.mine { border-color: #ffd23f; box-shadow: inset 0 0 0 1px #ffd23f; font-weight: 700; }
.zh-poll small { color: var(--dim, #a99bc4); }
.zh-poll small a { color: #ff8a1f; }
`;

let styled = false;
function style() {
    if (styled) return;
    styled = true;
    const el = document.createElement("style");
    el.textContent = CSS;
    document.head.append(el);
}

/** Fills `el` with `text`, turning "$r$...$r$" stretches into rainbow text. */
export function richText(el, text) {
    style();
    el.replaceChildren();
    String(text ?? "").split("$r$").forEach((part, i) => {
        if (!part) return;
        if (i % 2 === 0) el.append(document.createTextNode(part));
        else {
            const span = document.createElement("span");
            span.className = "zh-rb";
            span.textContent = part;
            el.append(span);
        }
    });
}

/** A name in the style its owner chose (null or none: plain). */
export function nametag(el, name, tag) {
    style();
    el.textContent = name;
    el.classList.remove("zh-rb");
    el.style.color = "";
    if (tag?.mode === "rainbow") el.classList.add("zh-rb");
    else if (tag?.mode === "color" && /^#[0-9a-f]{6}$/i.test(tag.color)) el.style.color = tag.color;
}

const queue = [];
let open = null;

function next() {
    if (open || !queue.length) return;
    const { title, text, by, done } = queue.shift();
    style();
    // A game that has the mouse captured gives it back, so the button can be clicked.
    document.exitPointerLock?.();
    const overlay = document.createElement("div");
    overlay.className = "zh-notice";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    const card = document.createElement("div");
    card.className = "zh-card";
    const head = document.createElement("h3");
    head.append(document.createTextNode(title ?? "Notice"));
    if (by) {
        head.append(document.createTextNode(" from "));
        const who = document.createElement("span");
        nametag(who, by.display ?? by.name, by.nametag);
        head.append(who);
    }
    const body = document.createElement("p");
    richText(body, text);
    const foot = document.createElement("div");
    foot.className = "zh-foot";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "ok";
    const close = () => {
        overlay.remove();
        open = null;
        done?.();
        next();
    };
    ok.addEventListener("click", close);
    overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape" || e.key === "Enter") close();
    });
    foot.append(ok);
    card.append(head, body, foot);
    overlay.append(card);
    document.body.append(overlay);
    open = overlay;
    ok.focus();
}

/** Shows a dialog (one at a time); resolves when the player presses ok. */
export function showNotice(options) {
    return new Promise((resolve) => {
        queue.push({ ...options, done: resolve });
        next();
    });
}

/**
 * Draws a shout's poll into `el`: each option with its votes, the player's own
 * pick marked. `vote(index)` is called on a click; `loginHref` is where "log in
 * to vote" leads (the player isn't logged in when `shout.poll.mine` can't be set).
 */
export function renderPoll(el, shout, { vote, loggedIn, loginHref = "index.html#account" }) {
    style();
    el.replaceChildren();
    const poll = shout?.poll;
    el.hidden = !poll;
    if (!poll) return;
    el.classList.add("zh-poll");
    poll.options.forEach((option, i) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `zh-opt${poll.mine === i ? " mine" : ""}`;
        const pct = poll.total ? Math.round((option.votes / poll.total) * 100) : 0;
        button.style.setProperty("--pct", `${pct}%`);
        const bar = document.createElement("i");
        const label = document.createElement("span");
        label.textContent = option.text;
        const count = document.createElement("span");
        count.textContent = `${option.votes} · ${pct}%`;
        button.append(bar, label, count);
        button.addEventListener("click", () => vote(i));
        if (!loggedIn) button.disabled = true;
        el.append(button);
    });
    const foot = document.createElement("small");
    foot.append(document.createTextNode(`${poll.total} vote${poll.total === 1 ? "" : "s"}`));
    if (!loggedIn) {
        foot.append(document.createTextNode(" · "));
        const link = document.createElement("a");
        link.href = loginHref;
        link.textContent = "log in to vote";
        foot.append(link);
    }
    el.append(foot);
}
