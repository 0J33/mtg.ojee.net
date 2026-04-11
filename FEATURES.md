# mtg.ojee.net — features

Full list of what the app does, grouped by area.

## rooms & multiplayer

- create rooms with short 6-character codes (unambiguous alphabet, no 0/O/1/I)
- invite links at `/invite/{code}` — copied to clipboard automatically on room creation
- role picker on invite link: join as player or spectator before entering
- room code hidden in the topbar by default — click once to reveal, click again to copy the invite url
- host + up to N seated players (configurable cap, default 8)
- session remembered across page reloads — refresh drops you back into your last room in the same role
- host can kick players (with confirmation)
- automatic room cleanup after all players disconnect

## decks

- build decks in the lobby or in-game without leaving the table
- scryfall-backed live card search in deck builder with color/type/text filters
- import from moxfield via "copy as plain text" → paste from clipboard button, single-click import
- import from pasted text with auto-commander detection (legendary creatures, vehicles, planeswalkers with "can be your commander")
- share decks via short 8-character codes (server-side share collection, 180-day ttl)
- deck share import: picker between **copy** (new independent custom card records) and **link** (reference the original author's cards — their edits propagate to you automatically)
- view, edit, delete, rename decks from anywhere
- each deck shows its author ("shared by x") when imported
- preview card hover in deck viewer with proper letterboxing

## custom cards

- create custom cards with name, image url, mana cost, type line, oracle text, power/toughness, colors
- per-user custom card library, accessible from the lobby or deck builder
- share custom cards individually via share codes
- stable `originId` per card — editing a custom card fans out to every deck entry that references it, including shared/linked imports across other users
- author attribution shown in deck list, deck viewer, and maximized card view ("by ojee")

## gameplay

- real-time multiplayer via socket.io
- drag-and-drop cards between all mtg zones: hand, battlefield, graveyard, exile, library, command zone
- battlefield split into configurable rows (creatures, artifacts/enchantments, lands, command zone) with per-card override
- multi-select via shift/ctrl/cmd click or tap (touch)
- bulk move / bulk tap / bulk untap for selected cards
- tap/untap individual cards or everything (with optional "lands only" filter)
- unified flip action: dfc cards swap sides, non-dfc cards toggle face-down
- draw any number of cards, mill any number, scry any number
- scry: reorder top-n, send specific cards to bottom
- tutor: search library for a specific card, place it in any zone, optional shuffle-after (now opt-in)
- place a card back into the library at a chosen position (top/bottom/index)
- library view with order or alphabetical sort
- hand view is private per player
- counters on cards (+1/+1, -1/-1, custom) with step buttons and clear
- notes on cards (free text + optional attached card reference)
- reveal a card to all players or specific ones (sender excluded from "all")
- reveal your hand to all or specific players

## life, damage & combos

- life total editing (click to type, +/- buttons)
- infinite value support for combos — type `∞`, `inf`, or `infinity` for life, counters, commander damage, or poison
- commander damage tracking per opponent → automatically reduces target's life total
- infect / poison counters (10 = death)
- commander deaths + tax (auto-incremented when commander returns to command zone from graveyard)
- player counters: poison, energy, experience, custom-named
- designations (visual only, no rules enforcement): monarch, initiative, city's blessing, day/night
- custom backgrounds per player zone

## turns

- turn indicator in the topbar showing whose turn it is
- **only the current turn player** (or host for afk cases) can end the turn
- **eliminated players auto-skipped** when advancing turns (life ≤ 0, 21+ commander damage, 10+ poison)
- **turn-start nudges**: the draw button glows amber until you draw; land cards in your hand glow until you drop one — silent hints, not enforced
- per-player auto-untap toggle (defaults on)
- first-turn player correctly skips their opening draw (mtg rule)
- mulligan progression: 7 → 7 → 6 → 5, then blocked
- next turn broadcasts a notification banner to all players

## drawing overlay

- free-hand pen tool with color picker (16 colors) and variable brush size
- eraser tool with hit-testing against stroke paths, tolerance scales with brush size
- clear mine / clear all
- touch drawing support (native listeners with preventDefault, touch-action none)
- aspect-ratio-aware letterboxing: strokes stay geometrically correct between desktop and mobile viewers (circles stay circular instead of stretching into ovals)
- pen button lives on the left edge, out of the way of player zones
- escape to exit drawing mode

## live cursors

- desktop players see each other's mouse cursors in real time
- per-user color via stable hash of userid
- username label next to each cursor
- auto-fade after 3 seconds of no movement
- throttled to ~20fps with a trailing emit so fast flicks still land
- aspect-ratio-aware letterboxing, same math as drawings
- restricted to non-touch + non-compact desktop users on both send and receive (layouts differ too much otherwise)
- per-user toggle in the topbar, persisted to localstorage
- spectators can participate

## chat

- side panel on the right edge, collapsible, unread badge when closed
- persistent per-room chat history (200 message cap)
- survives server restarts
- spectators can chat — their messages show a `[spec]` tag
- enter to send, shift+enter for newline
- chat log ships with gamestate so late joiners see the full history

## action log

- side panel mirroring chat's visual pattern
- full history of every mutating event + turn start/end + auto-untap + opening draws + mulligans + victory
- pretty-printed per event type, timestamps local, auto events shown italic/faint to distinguish from manual
- visible to everyone including spectators who join late
- 200 entry cap, persists to mongodb

## spectators

- join any room without taking a seat, via lobby "spectate" button or invite link
- see every player's hand face-up, library counts, complete board state
- can only chat and (if desktop non-compact) share cursors
- all mutating events blocked server-side by middleware allowlist, not just hidden client-side
- topbar shows `👁 n watching` for players — click to see spectator usernames
- spectator presence is ephemeral (not persisted) but chat messages they send persist like anyone else's
- can leave and rejoin without affecting game state

## victory

- detected automatically when one non-eliminated player remains
- fullscreen gold animation with 👑 and winner name (6.5 seconds)
- broadcast as a one-shot event — won't spam if state bounces
- also logged in the action log with a gold highlight
- cleared on next `startGame` for rematches

## dice & coins

- roll 1–20 dice of any sides (d4, d6, d8, d10, d12, d20, d100, custom)
- flip 1–20 coins
- results broadcast as transient toasts at the top of the screen
- entries logged in the action log

## tokens & on-the-fly cards

- token search via scryfall's token layer
- create custom cards on the fly during a game (saved to the player's library optionally)
- custom background image per player zone for branding decks

## undo

- undo the last mutating action (automatic snapshot-before-event)
- 30-deep history
- logged in the action log
- works for most state-changing events (move, tap, counter, life, draw, etc.)

## guide / help

- paged in-app how-to-play guide, opens via topbar button (never auto-shown)
- ~10 pages covering: welcome, zones, card movement, life/counters, turns, drawing, chat/cursors/spectators, inviting, decks & custom cards, tips & shortcuts
- navigation via on-screen ◀ / ▶ arrows, keyboard ← / →, clickable page dots, esc to close
- content updated in sync with feature additions

## mobile support

- responsive layout: player zones stack vertically, modals go full-screen, card sizes shrink
- touch-first interactions: tap to select, sticky bottom toolbar replaces right-click menus
- player options available via ⋮ button (no right-click on touch)
- hover zoom disabled on touch devices
- long-press image callout and text selection suppressed inside the game area so dragging doesn't fight with the os
- fixed scroll chaining (no "scroll the navbar too" issue)
- 100dvh layout tracks the mobile browser url bar so nothing gets clipped
- modal headers sticky so the close button is always reachable on tall content
- compact toggle and live cursors hidden on mobile (they don't make sense there)
- drawing works with native touch listeners, touch-action none while active

## auth & sessions

- username/password registration and login
- bcrypted passwords
- session cookies (httponly, secure, samesite)
- per-user deck and custom card libraries
- auto-rejoin saved room on reconnect (via localstorage)
- clean logout flow

## infrastructure

- react 19 client (create react app)
- node/express backend with socket.io
- mongodb via mongoose
- scryfall public api for card data, proxied server-side with batching + rate-limit handling
- single-box deployment: pm2-managed node process + nginx for static files
- room state in-memory with 30-second autosave to mongodb
- idempotent startup migrations (custom card origin backfill ran once to stabilize existing data)
- socket middleware gate for spectator-allowed events
- deck share codes with ttl auto-expiry via mongodb ttl index
