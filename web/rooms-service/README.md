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

Then list its addresses in `ROOMS_APIS` in `web/config.js` (no trailing slash; tried in order, so a network that blocks one falls back to the next) and publish the site. `wrangler.toml` also routes `rooms.bonziworld.lol` and `rooms.zebbigcool.qzz.io` to it; those domains' DNS zones must be on your Cloudflare account.
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

## Shared-world relay

The same Worker also runs an EaglerSPRelay-compatible relay at `/relay` (WebSocket). Hosts get a join
code from it and players are introduced to hosts through it; the game itself then flows over WebRTC.
`web/config.js` points the game at it automatically (`RELAY_URLS`, derived from `ROOMS_APIS`), ahead of the
public relays the game knows, so worlds shared from one site or device can be joined from any other.

After pulling, redeploy (`npx wrangler deploy` here; it applies the `v2` migration). Players behind strict
NATs may need a TURN server: set `TURN_URL` in `wrangler.toml` and `TURN_USER` / `TURN_PASS` with
`npx wrangler secret put`. Test the logic with `node relay.test.mjs`.
