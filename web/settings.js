// The player's settings, kept in this browser (localStorage), read by the
// launcher's settings page and by the game page (main.js, game.html).
import { publicRoomsOn, setPublicRooms } from "./presence.js";

export { publicRoomsOn, setPublicRooms };

const RAM_KEY = "horizon-ram-mb";
const DEBUG_KEY = "horizon-debug";

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
