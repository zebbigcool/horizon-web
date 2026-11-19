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

## Accounts, staff, announcements and the shout

`src/accounts.js` (one more Durable Object, `AccountsObject`, migration `v3`) holds the accounts and everything
the owner controls. After pulling: set the owner's password, then redeploy.

```sh
npx wrangler secret put ADMIN_PASSWORD   # the password of the owner account "Zeb"; never in the repo
npx wrangler secret put IP_SECRET        # optional: any long random text; keys the hashes of banned networks (keep it fixed)
npx wrangler deploy
```

Until `ADMIN_PASSWORD` is set the owner can't log in (the "Zeb" name is reserved either way).

- **Accounts**: sign up / log in with a username and password (PBKDF2-SHA256, 100k rounds; only the hash is
  stored). A session token is kept in the browser; passwords can't be reset. **Cloud save** (Account page) keeps
  the launcher settings and the default instance's files (about 12 MB) in the account.
- **Roles** (the owner sets them, by searching profiles; the list shows each one's skin name):
  mod kicks; janitor kicks and bans; admin kicks, bans and IP bans; the owner does all of it plus roles,
  nametag, announcements and the shout. A rank can only act on a lower one.
- **Kick** blocks play for 10 minutes; **ban** blocks it until lifted; **IP ban** blocks the whole network
  from the site, sign-ups and the relay. "Blocks play" means the launcher refuses Launch/Join and an open game
  page closes within about 20 seconds (the page checks on every presence ping). Players who are not logged
  in can be stopped only by an IP ban.
- **Undo**: every kick, ban, IP ban, unban and role change is in the Staff page's activity list, and each can be
  undone by someone of the rank that could have done it (role changes by the owner only). The IP ban list shows
  masked networks (`203.0.*.*`) with an Unban button; unbanning is itself undoable. IPs are stored only as keyed hashes.
- **Announcements** pop up once for everyone, as a dialog from the owner; `$r$text$r$` makes rainbow text.
  The **shout** stays on the Play page until the owner changes or deletes it there.
- Nametag: the owner picks rainbow or a color on the Account page; it shows in dialogs, the shout and lists
  (not above heads in the game).

Test: `node --test web/rooms-service/accounts.test.mjs web/rooms-service/worker.test.mjs` (the second runs the real Worker's routing with in-memory Durable Objects).
