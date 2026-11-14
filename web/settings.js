// The player's settings, kept in this browser (localStorage), read by the
// launcher's settings page and by the game page (main.js, game.html).
const RAM_KEY = "horizon-ram-mb";
const DEBUG_KEY = "horizon-debug";
const THEME_KEY = "horizon-theme";
const CLIENT_KEY = "horizon-client";
const FULLSCREEN_KEY = "horizon-fullscreen";
const RELAYS_KEY = "horizon-relays";
const PUBLIC_KEY = "horizon-public-room";

const read = (key) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};
const write = (key, value) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage blocked: the setting just doesn't stick.
    }
};

// The most memory the game may use, in MB; 0 is the browser's default (the
// build's own limit, 4 GB). A lower cap also asks the browser to set aside less.
export const RAM_CHOICES = [0, 512, 768, 1024, 1536, 2048, 3072];
export const ramMb = () => {
    const n = Number(read(RAM_KEY));
    return Number.isFinite(n) && n >= 256 ? Math.floor(n) : 0;
};
export const setRamMb = (mb) => write(RAM_KEY, String(mb));

// Show the game's log on screen (for devices without DevTools).
export const debugOn = () => read(DEBUG_KEY) === "1";
export const setDebug = (on) => write(DEBUG_KEY, on ? "1" : "0");

// "classic" (game.html) or "new" (NEWgame.html).
export const client = () => (read(CLIENT_KEY) === "new" ? "new" : "classic");
export const setClient = (value) => write(CLIENT_KEY, value);

// "system", "light" or "dark".
export const theme = () => {
    const value = read(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
};
export const setTheme = (value) => write(THEME_KEY, value);

// The launcher goes full screen on the first tap or key press.
export const fullscreenOn = () => read(FULLSCREEN_KEY) === "1";
export const setFullscreen = (on) => write(FULLSCREEN_KEY, on ? "1" : "0");

// Shared-world relays the player added: [{ name, url }], tried before the built-in one.
export const customRelays = () => {
    try {
        const list = JSON.parse(read(RELAYS_KEY) ?? "[]");
        return Array.isArray(list)
            ? list.filter((r) => r && typeof r.url === "string" && /^wss?:\/\//.test(r.url)).map((r) => ({ name: String(r.name ?? r.url), url: r.url }))
            : [];
    } catch {
        return [];
    }
};
export const setCustomRelays = (list) => write(RELAYS_KEY, JSON.stringify(list));

// Forgets every setting above and the public-worlds choice; the game's saves
// are not touched.
export const clearSettings = () => {
    for (const key of [RAM_KEY, DEBUG_KEY, THEME_KEY, CLIENT_KEY, FULLSCREEN_KEY, RELAYS_KEY, PUBLIC_KEY]) {
        try {
            localStorage.removeItem(key);
        } catch {
            // Nothing to clear.
        }
    }
};
