# Rooms service

A small Cloudflare Worker behind z's horizon's launcher: the **public rooms** list and the
**online** count. Each open browser tab sends a presence ping, and a host who hasn't switched it off sends a
heartbeat for the shared world it hosts. Entries expire by themselves (a tab after 45 s, a room
after 30 s of silence), so nothing needs cleaning up. The state lives in one Durable Object's memory.

## Deploy

```sh
cd web/rooms-service
npx wrangler login
npx wrangler deploy        # prints https://horizon-rooms.<you>.workers.dev
```

Then set `ROOMS_API` in `web/config.js` to that address (no trailing slash) and publish the site.
The Worker allows any origin (CORS `*`); it holds no secrets and no accounts.

## API

| Request | Body | Answer |
| --- | --- | --- |
| `GET /api/rooms` | | `{ "rooms": [{code, owner, name?, players, maxPlayers?, public: true}], "online": n }` |
| `GET /api/online` | | `{ "online": n }` |
| `POST /api/presence` | `{ "id" }` (one per tab) | `{ "online": n }` |
| `POST /api/rooms/heartbeat` | `{ code, key, owner, name?, players, maxPlayers? }` | `{}`; `409` if the code is held by another `key` |
| `POST /api/rooms/close` | `{ code, key }` | `{}` |

Pages send POST bodies as `text/plain` (JSON inside) so browsers make no CORS preflight.
A room's `key` is made by the host's page and set by its first heartbeat: later heartbeats
and the close must bring the same one, so nobody else can take over or close a listing.

Nothing checks that a code is a real relay code: anyone could list a fake room. It is a
convenience list, not a trust boundary.

## How the game feeds it

`horizon-os` (`net.rs`) tells the page about shared worlds it hosts (`globalThis.horizonSharedWorld`:
`open`, `players`, `closed`). `web/presence.js` turns those into heartbeats, only while the player has
ticked "list the worlds I share as public rooms" on the launcher's minecraft page (on by default,
kept in the browser's localStorage). The owner is the host's profile name; `players` counts the host.

## Test

```sh
node web/rooms-service/registry.test.mjs
```
