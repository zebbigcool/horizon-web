// Settings for the launcher page (index.html). Edit these to point it at your servers.

// Shown in the "chat" option's iframe.
export const CHAT_URL = "https://chat.zebbigcool.qzz.io";

// The game page the "Launch!" button opens.
export const GAME_URL = "game.html";

// The rooms service (web/rooms-service, a Cloudflare Worker): the public rooms
// and the online count. Its address once deployed, with no trailing slash, e.g.
// "https://horizon-rooms.<your-subdomain>.workers.dev". Left empty, the
// minecraft option says the service isn't set up and no online count shows.
export const ROOMS_API = "";

// How often the room list refreshes while the minecraft option is open.
export const REFRESH_MS = 15000;
