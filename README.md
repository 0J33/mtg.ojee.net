# mtg.ojee.net

A small, self-hosted Commander / EDH tabletop simulator I built for my
playgroup. It's a tool, not a rules engine — it shuffles your deck, moves
cards around, tracks life totals and counters, and lets you draw arrows on
the board, but it doesn't enforce the rules of Magic. You and your friends
do that yourselves.

Live instance: **[mtg.ojee.net](https://mtg.ojee.net)** — running on a single
self-hosted box behind nginx + PM2.

## What it does

**Gameplay**
- Rooms with short invite codes and shareable invite links — anyone with the
  link picks whether to join as a player or spectator
- Real-time state via socket.io: card positions, taps, life, counters,
  commander damage, infect, designations (monarch, initiative, day/night,
  city's blessing)
- Drag-and-drop between zones (hand, battlefield split by card type,
  graveyard, exile, library, command zone)
- Per-player auto-untap, mulligan progression (7 → 7 → 6 → 5), undo history,
  auto-skip eliminated players, victory detection, infinite values for
  combos
- Free-hand drawing overlay with pen + eraser, aspect-ratio-aware so shapes
  don't stretch between desktop and mobile
- Live cursors between desktop players (non-compact mode only)
- Chat sidebar, action log with full history, paged how-to-play guide

**Decks and custom cards**
- Build decks inside a room or from the lobby — the Deck Builder has a
  Scryfall-backed search
- Import from Moxfield via "Copy as plain text" (one-click paste from
  clipboard)
- Custom cards with image URLs, stored in a per-user library and shareable
  across your own decks
- Deck + custom card sharing via short 8-character codes (stored
  server-side, 180-day TTL)
- When importing a shared deck, the importer chooses whether to **copy**
  the custom cards (independent editable versions) or **link** to them
  (the original author's edits propagate to your deck automatically)

**Spectators**
- Join without taking a seat; see every player's hand face-up but can only
  chat and point with cursors

## Tech stack

- **Client**: React 19 (CRA), socket.io-client, HTML5 drag-and-drop, native
  canvas for drawings
- **Server**: Node/Express, socket.io, Mongoose
- **Database**: MongoDB
- **Card data**: Scryfall's public API (proxied server-side for batch
  lookups and rate-limit handling)
- **Deploy**: PM2-managed node process + nginx static serving, both on a
  single box

## Local development

### Prerequisites
- Node 18+ (I run 18.19 in production; anything newer should work)
- MongoDB running locally on the default port

### Server
```bash
cd server
npm install
# Create .env with at least:
#   MONGODB_URI=mongodb://localhost:27017/mtg
#   CLIENT_URL=http://localhost:3000
#   SESSION_SECRET=<random string>
node index.js
```

Server listens on `:5002` by default.

### Client
```bash
cd client
npm install
# Optional: set REACT_APP_SERVER_URL if your server isn't on localhost:5002
npm start
```

Client runs on `:3000`, proxies sockets + API calls to the server URL.

### First run
- Register a user on the login page
- Create a room, paste a Moxfield deck in plain-text format, play

## Caveats

It's a personal project built for one playgroup. A few things worth knowing
if you're thinking of running your own instance:

- **Not designed for scale.** Rooms are in-memory with periodic MongoDB
  autosave. Fine for a dozen concurrent rooms, not fine for a public server.
- **No rate limiting** on most endpoints. Add some if you're exposing it
  to the internet.
- **No rules enforcement.** Priority passing, the stack, triggered
  abilities, replacement effects — all on the players.
- **Moxfield URL import is disabled.** Moxfield's API is gated behind
  Cloudflare and requires a case-by-case API access grant from their team.
  The Paste Text tab with "Copy as plain text" is the working path.

## License

No license. All rights reserved for now. If you want to fork it or run your
own instance, ask me.
