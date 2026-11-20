// For the chat site (chat.zebbigcool.qzz.io), not the launcher: lets z's horizon's Chat tab show a dot.
// Include it in the chat page (or paste it in), then call:
//
//   horizonChat.message(text, { mine: true|false })   for every chat message that appears
//   horizonChat.clear()                               optional: when the user reads everything on its own
//
// A message that mentions the user (@name, or the name as a whole word, any case) counts as a ping.
// The launcher tells this page who the user is (their z's horizon username) and whether the Chat tab is
// open; while it is open nothing counts as unread. Nothing happens when the page isn't inside the launcher.
(() => {
    if (window.parent === window) {
        window.horizonChat = { message() {}, clear() {}, host: { visible: true, name: "" } };
        return;
    }
    const host = { visible: false, name: "" };
    let unread = 0;
    let pinged = false;
    const send = () => window.parent.postMessage({ type: "horizon-chat", unread, pinged }, "*");
    const clear = () => {
        if (!unread && !pinged) return;
        unread = 0;
        pinged = false;
        send();
    };
    const isPing = (text) => {
        const name = host.name.trim();
        if (!name) return false;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^A-Za-z0-9_])@?${escaped}(?![A-Za-z0-9_])`, "i").test(String(text));
    };
    addEventListener("message", (e) => {
        if (e.source !== window.parent || e.data?.type !== "horizon-chat-host") return;
        host.visible = e.data.visible === true;
        host.name = typeof e.data.name === "string" ? e.data.name.slice(0, 32) : "";
        if (host.visible) clear();
    });
    window.horizonChat = {
        host,
        clear,
        message(text, { mine = false } = {}) {
            if (mine || host.visible) return;
            unread++;
            if (isPing(text)) pinged = true;
            send();
        },
    };
})();
