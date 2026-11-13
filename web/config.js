// Settings for the launcher page (index.html). Edit these to point it at your servers.

// Shown in the "chat" option's iframe.
export const CHAT_URL = "https://chat.zebbigcool.qzz.io";

// The game page the "Launch!" button opens.
export const GAME_URL = "game.html";

// The rooms service (web/rooms-service, a Cloudflare Worker): the public rooms
// and the online count. Its address once deployed, with no trailing slash, e.g.
// "https://horizon-rooms.<your-subdomain>.workers.dev". Left empty, the
// minecraft option says the service isn't set up and no online count shows.
export const ROOMS_API = "https://horizon-rooms.zebsother.workers.dev";

// Where seraph (github.com/Zebbigcool/seraph) is hosted, for the "games" and
// "apps" options: every game and app is loaded from there (the list of what
// exists is catalog.json, made by seraph_catalog.py). Seraph is meant to be
// rehosted, e.g. on GitHub Pages; with no trailing slash. Left empty, those
// options say seraph isn't set up.
export const SERAPH_URL = "https://zebbigcool.github.io/seraph";

// How often the room list refreshes while the minecraft option is open.
export const REFRESH_MS = 15000;

// The shared-world relay: where hosts get join codes and players are introduced
// to hosts. By default it is the rooms service's own (its /relay endpoint), so
// codes work from any site or device that uses it; the public relays the game
// knows stay as fallbacks. Set to a "wss://..." address to use another, or to
// "" to use only the game's defaults.
export const RELAY_URL = ROOMS_API ? ROOMS_API.replace(/^http/, "ws") + "/relay" : "";
