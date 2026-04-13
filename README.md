# mtg.ojee.net

an mtg tabletop sim i built for me and my friends to play magic in the browser. supports commander, standard, modern, legacy, vintage, pauper, oathbreaker, draft, and sealed. live at [mtg.ojee.net](https://mtg.ojee.net).

it's not a rules engine, just a table. you drag cards around, flip them, track life and counters, draw arrows on the board. the actual magic rules are on you and your friends.

## what it does

- rooms with invite links, join as player or spectator
- build decks in the lobby or mid-game, import from moxfield url (rate-limited api) or pasted text
- custom cards with image urls, shareable across your decks
- deck share codes — importer picks copy (independent) or link (author's edits propagate)
- drag cards between zones, mana pool with tap-for-mana, infinite values for combos
- mulligan rules pick: vancouver, london (with bottoming), or free-7
- damage / phasing / suspend / goad / temp-control on creatures, all clearable on end of turn
- foretell pile, sideboard / companions / emblem zones (only render when non-empty)
- the stack, extra-turn queue, proliferate, clone, cast-from-grave (with auto-exile-after)
- teams with shared life and team victory detection
- mid-game ⚙ Settings modal for starting life, format, max players, hand-size limit
- chat with direct messages, action log, drawing overlay with pen / eraser / brush preview, live cursors, victory animation

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
- moxfield url import works via [`server/moxfieldClient.js`](server/moxfieldClient.js), which serializes every outgoing call through a single promise queue with a 10-second floor + a 5-second hard sanity backstop. requires `MOXFIELD_USER_AGENT` set in the server `.env`.
- no rules enforcement. priority, stack, triggers, all on the players. the stack panel and mana pool are tools, not engines.

## see also

- [FEATURES.md](FEATURES.md) — full feature catalog grouped by area
- [FEATURES_TEST.md](FEATURES_TEST.md) — test plan for the latest big-batch deploy

## disclaimer

Magic: The Gathering, MTG, the MTG logo, and all associated card names, images, mana symbols, and game mechanics are trademarks and copyrights of Wizards of the Coast LLC. This is an unofficial fan project — not produced, endorsed, supported, or affiliated with Wizards of the Coast in any way. Card data and images are provided by [Scryfall](https://scryfall.com). Deck import is powered by [Moxfield](https://moxfield.com)'s API. Neither Scryfall nor Moxfield are affiliated with this project.

## license

no license yet. ask me if you want to fork or run your own.
