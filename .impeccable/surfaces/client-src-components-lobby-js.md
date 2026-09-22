---
version: 1
slug: "client-src-components-lobby-js"
primary_target: "client/src/components/Lobby.js"
related_targets: ["client/src/components/Login.js"]
---

Scope: mtg.ojee.net sign-in and home (lobby). Visitor mode: Operate.
Audience and job: the friend group on game night; get into a table in seconds (join a friend's, start one, spectate), keep decks ready.
Constraints: the in-game board's world is kept (near-black, gold accent, Cinzel caps, EB Garamond); the WotC disclaimer stays visible; one account shared with dnd.ojee.net.

## Direction contract

THESIS: Home is tonight's noticeboard of open tables you walk up to and sit at; it refuses the stacked settings-panel lobby.
OWN-WORLD: The board's near-black and gold, zone-tinted table slips with seat pips and seated commanders' art crops, Cinzel tracked labels, italic Garamond notes, hairline borders.
STORY: A player sees which tables are open, who is seated and what they play, and joins or spectates in one click; decks sit ready beside the board.
FIRST VIEWPORT: Slim top bar (logo, join-by-code, you). Left two-thirds: "Start a table" slip first, then live table slips in a grid. Right third: your decks column with commander art. Sign-in: one slip over the dimmed board with the open-table count.
FORM: Game Night Board, position 5 of 7, seed dfc885fe (raised with commander art from position 4).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
