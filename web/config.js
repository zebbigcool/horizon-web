// Settings for the launcher page (index.html). Edit these to point it at your servers.

// Shown in the "chat" option's iframe.
export const CHAT_URL = "https://chat.zebbigcool.qzz.io";

// The game page the "Launch!" button opens.
export const GAME_URL = "game.html";

// Where the "minecraft" option loads the list of rooms from. It must answer a
// GET with JSON and allow cross-origin reads (Access-Control-Allow-Origin).
// Either an array of rooms or { "rooms": [ ... ] }, each room like:
//   { "code": "ABCD-1234", "owner": "zeb", "players": 3, "maxPlayers": 8, "public": true }
// `maxPlayers` and `name` are optional; a room with `"public": false` is not listed.
export const ROOMS_URL = "https://chat.zebbigcool.qzz.io/api/rooms";

// How often the room list refreshes while the minecraft option is open.
export const REFRESH_MS = 15000;
