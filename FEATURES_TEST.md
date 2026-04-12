# Big-batch features — test plan

This is the punch list of new features in the latest deploy. Walk through it
top-to-bottom and tick each one. Items are grouped by where you trigger them
so you can knock out a section in one go.

The mapping at the end shows which numbered items from the missing-features
inventory each feature covers.

## 0. Smoke test (do this first)

- [ ] Create a room, load a deck, start a game — confirm the existing flow
      still works exactly as before
- [ ] Mulligan once — confirm the d20 first-player phase still happens
- [ ] End a turn — confirm next turn advances + auto-untap fires
- [ ] Right-click a card — confirm the existing menu still has all the old items

If any of those break, stop and shout — the new code regressed something.

## 1. Settings modal (⚙ button in topbar)

- [ ] Click the new **⚙** button in the topbar — Settings modal opens
- [ ] Pick a format preset (Brawl) → starting life updates to 30 in the form
- [ ] Change starting life to 50, save → if game hasn't started yet, every
      player's life jumps to 50
- [ ] Change Mulligan rules to **London** → next mulligan should auto-prompt
      bottoming
- [ ] Toggle **Shared life across teammates** ON
- [ ] Set **My team ID** to "A", save → your teamId becomes "A"
- [ ] Change avatar color via the color picker → the dot next to your name
      updates immediately

## 2. Mana pool (basic land tap)

- [ ] Right-click a basic Forest on your battlefield → **Tap for mana** option
- [ ] Click it → land taps + a green mana pip appears in your player header
- [ ] Click the green pip → counter goes down by one (manual spend)
- [ ] Shift-click the pip → counter goes up by one (manual fix-up)
- [ ] Click the **×** at the end of the strip → pool empties
- [ ] End your turn → pool clears automatically

## 3. Mana picker (non-basic land tap)

- [ ] Right-click a non-basic land like Steam Vents → **Tap for mana**
- [ ] Mana picker modal opens with WUBRG + colorless buttons
- [ ] Click U then R → "Selected: U R" appears at the bottom
- [ ] Hit **Tap** → land taps + both mana appear in pool

## 4. Card-state badges (battlefield)

- [ ] Right-click a creature → **Mark damage...** → enter 3 → red "3" badge
      top-left
- [ ] End your turn → damage clears (back to 0) on every creature
- [ ] Right-click a creature → **Suspend counters...** → enter 4 → purple "⌛4"
      badge top-right
- [ ] End your turn (their turn passes) → 4 → 3 → 2 → 1 → 0 (action log:
      "X is ready to cast")
- [ ] Right-click → **Phase out** → card goes faded/grayscale, opacity ~35%
- [ ] Right-click again → **Phase in** → opacity restores
- [ ] Right-click → **Goad** → orange "⚔" badge bottom-left
- [ ] Right-click → **Remove goad** → badge gone

## 5. Clone

- [ ] Right-click a battlefield card → **Clone (token)** → an identical card
      appears next to it on YOUR battlefield (marked as a token internally so
      it doesn't fight for the original card slot)

## 6. Cast from grave / exile / foretell (item 10)

- [ ] Drop a card in your graveyard
- [ ] Right-click it → **Cast → battlefield** → card moves to battlefield
- [ ] Right-click another graveyard card → **Cast → exile after** → card
      moves to battlefield AND the action log notes "exiles after" so you
      remember to send it to exile when it dies (manual)

## 7. Foretell (item 11)

- [ ] Right-click a card in hand → **Foretell** → card disappears from hand
- [ ] A new **Foretell (1)** strip appears next to graveyard/exile
- [ ] Click the Foretell strip to expand it → see the card face-down (you,
      the owner, see it; opponents see only the count)
- [ ] Right-click the foretold card → **Cast (foretold)** → moves to
      battlefield

## 8. Take control (items 20)

- [ ] Right-click an OPPONENT'S battlefield card → **Take control (until end
      of turn)**
- [ ] Card moves to your battlefield with a blue ring + ↶ badge
- [ ] End your turn → card returns to original owner, blue ring gone

## 9. Proliferate (item 18)

- [ ] Add a +1/+1 counter to one creature, infect 2 to a player
- [ ] Right-click your own player → **Proliferate**
- [ ] Counter on creature went +1, infect went +1, action log shows
      "proliferated (2 counters bumped)"

## 10. Extra turns (item 19)

- [ ] Right-click your own player → **Queue an extra turn**
- [ ] **↺ 1: <yourname>** indicator appears in topbar
- [ ] Pass turn → instead of advancing to the next player, comes back to you
- [ ] Indicator clears
- [ ] Right-click an opponent player → **Queue extra turn for them** also
      works

## 11. Hand-size enforce + concede (items 23, 29)

- [ ] Right-click your own player → **Hand-size enforce: ON**
- [ ] End a turn with > 7 cards in hand → notification "Discard X card(s) —
      hand-size limit 7" (it's a nudge, not auto-discard)
- [ ] Right-click your own player → **Concede** → confirmation → you go to
      0 life, "conceded" badge appears, victory check fires for the remaining
      players

## 12. Browse opponent library / take card (item 38)

- [ ] Right-click an opponent → **Browse full library...** → modal lists
      every card in their library, alphabetical filter at top
- [ ] Click a card to maximize it for inspection
- [ ] Click **Take** on a card → that card goes onto YOUR battlefield
      (Bribery / Acquire)

## 13. Reveal SPECIFIC cards from hand (item 37)

- [ ] Right-click your own player → **Reveal SPECIFIC cards from hand...**
- [ ] Click cards in your hand to select them (outlined in blue)
- [ ] Pick a target (All players or one specific opponent)
- [ ] Click **Reveal X** → opponent sees the same revealed-hand modal but
      only with those cards

## 14. Add emblems (item 27)

- [ ] Right-click your own player → **Add emblem...**
- [ ] Type "Teferi emblem" + "Whenever an opponent casts their first spell
      each turn, counter that spell." → Add
- [ ] An **Emblems (1)** strip appears next to graveyard/exile/library
- [ ] Click to expand → see the emblem text
- [ ] Click the × on the emblem → removed
- [ ] You can also add emblems to opponents via their context menu

## 15. The Stack (item 28)

- [ ] No client UI exposes the stack-push directly yet (intentional — push it
      via the action when you genuinely want it). Test via dev console or by
      adding a button later. For now, **the stack panel auto-shows** when
      something is pushed and a "Stack: N" indicator appears in the topbar.
- [ ] **Stack panel** at the top-center shows entries with the top one
      highlighted; click **Resolve** to pop the top, or **Clear** to empty.

(Stack push is currently a manual server emit; the natural place to wire it
is from "I cast a spell" — easy follow-up if you want a button on every card.)

## 16. London-mulligan bottoming (item 42)

- [ ] In Settings, switch Mulligan rules to **London (always 7, bottom N)**
- [ ] Mulligan once → bottoming modal auto-opens, asks for 1 card
- [ ] Click 1 card in your hand → "#1" badge → click **Bottom 1/1** → that
      card goes to library bottom
- [ ] Mulligan again → bottoming modal asks for 2 cards, in order

## 17. Team logic + shared life + team victory (items 30, 31)

- [ ] Two players join, both go to Settings → Team A
- [ ] Host turns Shared team life ON
- [ ] Either player adjusts life → both players' life moves together
- [ ] Two more players join Team B
- [ ] Eliminate everyone in Team B (set life to 0) → Team A team-victory
      banner fires (instead of waiting for one specific player)

## 18. Sideboard / companions zones (items 5, 21)

- [ ] Build a deck with 1-3 sideboard cards (the existing DeckBuilder
      supports it)
- [ ] Load that deck → **Sideboard (N)** strip appears next to graveyard/exile
- [ ] Click to expand → see the cards (only owner sees contents)
- [ ] Right-click a sideboard card → can Move to hand / battlefield / etc.
- [ ] If the deck has no sideboard, the strip is invisible — original layout
      preserved

## 19. Avatars (item 46)

- [ ] Each player now has a small color dot next to their username — generated
      from their userId
- [ ] In Settings → My avatar color → pick a different color → dot updates

## 20. Direct messages in chat (item 39)

- [ ] Open chat panel
- [ ] Pick a player from the new dropdown (DM → Alice)
- [ ] Send a message — only Alice + you see it (DMs marked with → and a blue
      left border)
- [ ] Switch back to All (public) → messages go to everyone again

## 21. Brush size preview (item 44)

- [ ] Toggle drawing pen on
- [ ] Hover over the canvas — a circle outline matches the current brush
      size, in your pen color
- [ ] Move the brush slider — circle resizes live
- [ ] Switch to eraser — circle outline turns white

## 22. Action log pretty-printers (item 45)

- [ ] Open action log
- [ ] All the new event types should appear with friendly text instead of raw
      event names: **addMana, tapForMana, foretell, castForetold, cloneCard,
      proliferate, queueExtraTurn, stackPush/Pop, addEmblem, takeControl,
      concede, mulliganBottom**
- [ ] No action should show as a raw event name (`actorName setBackground`
      is now `actorName changed their background`)

## 23. Spectator perspective (item 40)

- [ ] Join a room as spectator
- [ ] By default you see every player's hand
- [ ] Use dev console: `socket.emit('setSpectatorPerspective', { targetPlayerId: '<some-uid>' })`
- [ ] Now you only see THAT player's hand — useful for coaching streams.
      A topbar button is a natural follow-up.

## 24. Tutor with options (item 48)

- [ ] When tutoring a card to battlefield via the existing tutor flow, the
      backend now accepts `tapped`, `counters`, `faceDown` — the LibrarySearch
      modal can be extended to expose these. For now they're available via
      the new `tutorCardWithOptions` socket event for power users.

## 25a. Combat declaration (item 24, follow-up batch)

- [ ] Right-click YOUR own creature on the battlefield → submenu with **Attack → Alice**, **Attack → Bob**, etc. (one per opponent)
- [ ] Click **Attack → Alice** → creature gets a red ring (`.attacking` class)
- [ ] Open the same menu again → the entry now shows a ✓ next to Alice
- [ ] Click **Stop attacking** → ring goes away
- [ ] End your turn → the attacking marker auto-clears for everyone (server cleanup)

## 25b. Stack push from hand (item 28, follow-up batch)

- [ ] Right-click a card in your hand → **Push to stack**
- [ ] Topbar shows "Stack: 1" indicator + the floating stack panel appears at the top
- [ ] The card stays in your hand (the stack entry is just the name + image)
- [ ] Click **Resolve** on the top entry — it pops; click **Clear** to wipe the stack

## 25c. Spectator perspective dropdown (item 40, follow-up batch)

- [ ] Join a room as spectator
- [ ] Topbar shows the existing "Spectating" badge AND a new dropdown next to it: "View: all hands"
- [ ] Pick "View as: <player>" — gameState refreshes; only that player's hand is now visible, others go back to face-down
- [ ] Pick "View: all hands" again → all hands restore

## 25d. Tutor with options (item 48, follow-up batch)

- [ ] Open View Deck (tutor / library search)
- [ ] New row near the top: **When using Play:** [ ] Tapped  [ ] Face-down  [ ] +1/+1 counter
- [ ] Check "Tapped" + "+1/+1 counter"
- [ ] Click **Play** on a card → it enters battlefield tapped, with a +1/+1 counter
- [ ] Uncheck the boxes → click Play on another card → enters normally (server uses the cheaper plain `tutorCard`)

## 25e. Adventure cards (item 12, follow-up batch)

- [ ] Have a card with adventure layout in hand (e.g. Bonecrusher Giant — load via paste-text or Moxfield)
- [ ] Right-click it → menu shows **Cast adventure: Stomp** (or whatever the adventure side is named)
- [ ] Click it → "Stomp (adventure)" gets pushed to the stack AND the card moves from hand to exile
- [ ] On the next turn, right-click the card in exile → **Cast → battlefield** to play it as the creature side (which is the MTG rule: cast the adventure side, exile, then cast the creature from exile)

## 26. End-of-turn cleanup (item 17)

- [ ] Mark damage on multiple creatures
- [ ] Use **Take control (until EOT)** on an opponent's card
- [ ] Mark a creature as attacking (via `setCardField` for now)
- [ ] End your turn → damage clears, controlled card returns, attacking flag
      clears
- [ ] If hand-size enforce is ON for ending player and hand > 7, get a nudge

---

## Numbered-item coverage

| # | Feature | Where |
|---|---|---|
| 1 | Mana pool wired up + tap-for-mana picker | Card context menu → "Tap for mana", header widget |
| 5 | Sideboard / companions only when present | Auto on `loadDeck` |
| 9 | Clone | Card context menu → "Clone (token)" |
| 10 | Cast-from-grave/exile (auto-exile-after) | Card context menu in graveyard / exile |
| 11 | Foretell | Hand → "Foretell"; Foretell zone → "Cast (foretold)" |
| 12 | Adventure halves | Hand context menu → "Cast adventure: <name>" — pushes to stack, exiles the card; cast creature side from exile next |
| 13 | Face-down from hand | `moveCard` already supported `faceDown:true`; no additional UI needed beyond the existing Flip |
| 14 | Suspend counters | Card context menu → "Suspend counters..." + auto-tick on turn start |
| 15 | Damage on creature | Card context menu → "Mark damage..." + EOT clear |
| 16 | Phasing | Card context menu → "Phase out / Phase in" |
| 17 | EOT cleanup | Auto on `nextTurn` |
| 18 | Proliferate | Self player context menu |
| 19 | Extra turns queue | Self/opponent context menu + topbar indicator |
| 20 | Take control until EOT | Opponent card context menu |
| 21 | Sideboard/companion in-game | New zone strips on player |
| 22 | Look at opponent hand (request) | Already had revealHand; the *request* side is satisfied by DMing them: "show me your hand" |
| 23 | Concede | Self player context menu |
| 24 | Combat declaration | Self-creature context menu → "Attack → <opponent>"; red ring + auto-clear at EOT |
| 25 | Goad marker | Card context menu → "Goad / Remove goad" |
| 26 | Loyalty as a concept | Use existing card counter named "loyalty" — backend treats it generically |
| 27 | Emblem zone | New zone strip + "Add emblem" in player context menu |
| 28 | Stack | Hand-card context menu → "Push to stack"; floating panel with Resolve / Clear |
| 29 | Hand-size enforce per player | Self context menu toggle, EOT nudge |
| 30 | Team victory | `checkVictory` checks team-only-alive case |
| 31 | Shared team life | Settings toggle, propagates on adjustLife/setLife |
| 32 | Starting life setting | Settings modal |
| 33 | Commander damage threshold | Settings modal |
| 34 | Max players | Settings modal |
| 35 | Format selection | Settings modal (commander/brawl/modern/oathbreaker/free) |
| 36 | Mulligan rules selection | Settings modal (vancouver/london/free7) |
| 37 | Reveal specific cards | Self context menu → "Reveal SPECIFIC cards..." |
| 38 | Browse opponent library | Opponent context menu → "Browse full library..." |
| 39 | DM chat | Chat panel dropdown |
| 40 | Spectator perspective | Topbar dropdown for spectators: "View as: <player>" |
| 42 | London bottoming | Auto-modal when `mulliganBottomPending > 0` |
| 43 | Dice roll animation broadcast | The d20 first-player roll already broadcasts; manual rolls already broadcast via `rollResult` |
| 44 | Brush preview circle | Drawing canvas hover |
| 45 | Action log printers | Every new event has a friendly line |
| 46 | Player avatars | Color dot in player header |
| 47 | Dynamic mid-game settings | Settings modal works mid-game (host only) |
| 48 | Tutor with options | LibrarySearch checkboxes (Tapped, Face-down, +1/+1 counter); auto-uses `tutorCardWithOptions` when any are set |

**All five originally-deferred items shipped in the follow-up batch.** The
only remaining "minimal" notes:

- Adventure cards (12) — minimum implementation: pushes the adventure name
  to the stack and exiles the card. Doesn't store the adventure side's
  separate mana cost / oracle text — the user reads them off the card image.
  Extension if you want it later: extend the import path to also store
  `card_faces[1].mana_cost` / `oracle_text` and render them in the maximized view.
- Combat declaration (24) — only marks the *attacking* side. No blocker
  declaration UI. Blockers can be tracked manually with the existing cards
  by tapping them or by using a custom counter. Extension if you want it later:
  add a `blockingInstanceId` field on the card schema and a "Block <attacker>"
  submenu on opponents' attacking creatures.
- Stack push (28) — manual context-menu push. There's deliberately no
  automatic "every drag pushes to stack" because that's too noisy for a
  table where some plays don't actually use the stack (lands, abilities, etc.).
