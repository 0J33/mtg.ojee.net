# mtg.ojee.net

a small commander tabletop sim i built for me and my friends to play edh in the browser. live at [mtg.ojee.net](https://mtg.ojee.net).

it's not a rules engine, just a table. you drag cards around, flip them, track life and counters, draw arrows on the board. the actual magic rules are on you and your friends.

## what it does

- rooms with invite links, join as player or spectator
- build decks in the lobby or mid-game, import from moxfield with "copy as plain text"
- custom cards with image urls, shareable across your decks
- deck share codes — importer picks copy (independent) or link (author's edits propagate)
- drag cards between zones, auto-untap, mulligan 7 → 7 → 6 → 5, infinite values for combos
- chat, action log, drawing overlay with pen + eraser, live cursors, victory animation

## stack

react 19 client, node/express + socket.io server, mongodb. card data from scryfall. deployed via nginx + pm2 on a single box.

## running it locally

need node 18+ and a local mongodb.

server:

```bash
cd server
npm install
# .env needs:
#   MONGODB_URI=mongodb://localhost:27017/mtg
#   CLIENT_URL=http://localhost:3000
#   SESSION_SECRET=<random string>
node index.js
```

client:

```bash
cd client
npm install
npm start
```

register, make a room, paste a deck, play.

## heads up

- personal project, not built for scale. fine for a few rooms at once, not a public server.
- no rate limiting on most routes. add some if you expose it.
- moxfield url import is disabled — their api is cloudflare-gated. paste text works fine.
- no rules enforcement. priority, stack, triggers, all on the players.

## license

no license yet. ask me if you want to fork or run your own.
