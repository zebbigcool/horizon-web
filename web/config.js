// Settings for the launcher page (index.html). Edit these to point it at your servers.

// Shown in the "chat" option's iframe.
export const CHAT_URL = "https://chat.zebbigcool.qzz.io";

// The game page the "Launch!" button opens.
export const GAME_URL = "game.html";

// The rooms service (rooms-service/, a Cloudflare Worker): the public rooms, the
// online count and the shared-world relay. Every address it answers on, with no
// trailing slash, tried in this order: if a network blocks one (schools often
// block workers.dev), the next is used. Left empty, the minecraft option says the
// service isn't set up and no online count shows.
export const ROOMS_APIS = [
    "https://rooms.bonziworld.lol",
    "https://rooms.zebbigcool.qzz.io",
    "https://horizon-rooms.zebsother.workers.dev",
];
export const ROOMS_API = ROOMS_APIS[0] ?? "";

// Where seraph (github.com/Zebbigcool/seraph) is hosted, for the "games" and
// "apps" options: every game and app is loaded from there (the list of what
// exists is catalog.json, made by seraph_catalog.py). Seraph is meant to be
// rehosted, e.g. on GitHub Pages; with no trailing slash. Left empty, those
// options say seraph isn't set up.
export const SERAPH_URL = "https://zebbigcool.github.io/seraph";

// How often the room list refreshes while the minecraft option is open.
export const REFRESH_MS = 15000;

// The shared-world relay: where hosts get join codes and players are introduced
// to hosts. By default each rooms-service address also serves one (its /relay
// endpoint), so codes work from any site or device that uses it; the public
// relays the game knows stay as fallbacks. Set to [] to use only the game's.
export const RELAY_URLS = ROOMS_APIS.map((url) => url.replace(/^http/, "ws") + "/relay");
