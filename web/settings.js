// The player's settings, kept in this browser (localStorage), read by the
// launcher's settings page and by the game page (main.js, game.html).
const RAM_KEY = "horizon-ram-mb";
const DEBUG_KEY = "horizon-debug";
const THEME_KEY = "horizon-theme";
const RAW_KEY = "horizon-raw-mouse";
const SPIKE_KEY = "horizon-spike";
const CLIENT_KEY = "horizon-client";
const FULLSCREEN_KEY = "horizon-fullscreen";
const RELAYS_KEY = "horizon-relays";
const PUBLIC_KEY = "horizon-public-room";
const LOWMEM_KEY = "horizon-low-memory";
const LOWMEM_APPLIED_KEY = "horizon-low-memory-applied";

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

// Mouse look (read by game.html): raw input on unless "0"; the spike filter is
// "off", "normal" or "strict".
// Low-memory mode (on by default): fewer game threads, a lighter first-run
// options file, and the page's own copies of the resources dropped early.
export const lowMemory = () => read(LOWMEM_KEY) !== "0";
export const setLowMemory = (on) => {
    write(LOWMEM_KEY, on ? "1" : "0");
    // Turning it on again lights the options up once more.
    try {
        localStorage.removeItem(LOWMEM_APPLIED_KEY);
    } catch {
        // Nothing to clear.
    }
};

// Options written once when low-memory mode starts (the player's own changes
// in the game's menus stay after that): short distances, no clouds, minimal
// particles, no mipmaps or biome blending, and the cheapest lighting.
const LOW_OPTIONS = {
    renderDistance: "6", simulationDistance: "5", renderClouds: "false", particles: "2", entityShadows: "false",
    ao: "false", biomeBlendRadius: "0", mipmapLevels: "0", maxFps: "60", vignette: "false", weatherRadius: "3",
    entityDistanceScaling: "0.5", improvedTransparency: "false",
};

// Merges LOW_OPTIONS into options.txt in the game's saved files, once.
export async function applyLowMemoryOptions() {
    if (!lowMemory() || read(LOWMEM_APPLIED_KEY) === "1") return false;
    try {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("horizon", { create: true });
        let lines = [];
        try {
            lines = (await (await (await dir.getFileHandle("options.txt")).getFile()).text()).split(/\r?\n/).filter(Boolean);
        } catch (e) {
            if (e.name !== "NotFoundError") throw e;
        }
        const keep = lines.filter((line) => !(line.split(":")[0] in LOW_OPTIONS));
        const text = [...keep, ...Object.entries(LOW_OPTIONS).map(([k, v]) => `${k}:${v}`)].join("\n") + "\n";
        const out = await (await dir.getFileHandle("options.txt", { create: true })).createWritable();
        await out.write(text);
        await out.close();
        write(LOWMEM_APPLIED_KEY, "1");
        return true;
    } catch (e) {
        console.warn(`Horizon: could not apply the low-memory options: ${e}`);
        return false;
    }
}

// How many CPU threads the game may count on: two in low-memory mode.
export const cpuCap = () => (lowMemory() ? 2 : 0);

export const rawMouse = () => read(RAW_KEY) !== "0";
export const setRawMouse = (on) => write(RAW_KEY, on ? "1" : "0");
export const spikeFilter = () => {
    const value = read(SPIKE_KEY);
    return value === "off" || value === "strict" ? value : "normal";
};
export const setSpikeFilter = (value) => write(SPIKE_KEY, value);

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
    for (const key of [RAM_KEY, DEBUG_KEY, THEME_KEY, CLIENT_KEY, RAW_KEY, SPIKE_KEY, FULLSCREEN_KEY, RELAYS_KEY, PUBLIC_KEY, LOWMEM_KEY, LOWMEM_APPLIED_KEY]) {
        try {
            localStorage.removeItem(key);
        } catch {
            // Nothing to clear.
        }
    }
};
