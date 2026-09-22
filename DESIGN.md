---
name: mtg.ojee.net
description: A shared Magic table in the browser; home is tonight's noticeboard of open tables.
colors:
  table-gold: "#d4af6f"
  table-gold-lit: "#e2c287"
  table-gold-lead: "#e0bd7c"
  tarnished-gold: "#8a7350"
  gold-ink: "#17120a"
  void-black: "#050505"
  felt-black: "#0c0c0c"
  panel-black: "#131313"
  raised-black: "#1c1c1c"
  hairline-soft: "#2a2a2a"
  hairline: "#3a3a3a"
  bone-text: "#e8e8e8"
  ash-text: "#b0b0b0"
  smoke-text: "#808080"
  creature-green: "#80b078"
  artifact-amber: "#c0a070"
  land-blue: "#7090c0"
  blood-red: "#b04444"
  blood-red-text: "#d88080"
typography:
  wordmark:
    fontFamily: "Cinzel, serif"
    fontSize: "1.7rem"
    fontWeight: 600
    letterSpacing: "0.18em"
  headline:
    fontFamily: "Cinzel, serif"
    fontSize: "1.02rem"
    fontWeight: 600
    letterSpacing: "0.2em"
  title:
    fontFamily: "Cinzel, serif"
    fontSize: "1.08rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.06em"
  body:
    fontFamily: "EB Garamond, Georgia, serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.35
  note:
    fontFamily: "EB Garamond, Georgia, serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.3
  label:
    fontFamily: "Cinzel, serif"
    fontSize: "0.74rem"
    fontWeight: 600
    letterSpacing: "0.14em"
  field-label:
    fontFamily: "Cinzel, serif"
    fontSize: "0.68rem"
    fontWeight: 400
    letterSpacing: "0.16em"
  code:
    fontFamily: "Cinzel, serif"
    fontSize: "0.78rem"
    fontWeight: 400
    letterSpacing: "0.2em"
rounded:
  control: "2px"
  slip: "3px"
  panel: "4px"
  seat: "50%"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "22px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.table-gold}"
    textColor: "{colors.gold-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.table-gold-lit}"
  button-lead:
    backgroundColor: "{colors.table-gold-lead}"
    textColor: "{colors.gold-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "46px"
    width: "100%"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.bone-text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "36px"
  button-ghost-hover:
    textColor: "{colors.table-gold}"
  input:
    backgroundColor: "{colors.void-black}"
    textColor: "{colors.bone-text}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
    height: "42px"
  slip:
    backgroundColor: "{colors.panel-black}"
    textColor: "{colors.bone-text}"
    rounded: "{rounded.slip}"
    padding: "22px 18px 16px"
  seat-pip:
    backgroundColor: "{colors.raised-black}"
    rounded: "{rounded.seat}"
    size: "40px"
---

# Design System: mtg.ojee.net

## Overview

**Creative North Star: "The Game Night Board"**

Home is a corkboard framed like the play mat: every open table is a slip pinned to it, tinted in the same zone colours the in-game board uses, with seat pips that carry the seated commanders' art. The world is the board's own, carried outward: near-black felt, one warm gold, Cinzel set in tracked capitals for anything you name or press, italic EB Garamond for anything that speaks to you. Sign-in is one slip laid over a dimmed ghost of that board, so the first thing a player sees is that tables exist tonight.

The in-game board (App.css, GameBoard and its menus) is the incumbent world and is out of scope for redesign; players like it and PRODUCT.md holds it sacred. Its `:root` tokens are the shared base every surface inherits. The home, sign-in and invite surfaces add a thin layer on top, scoped under `.mh-`, and never restyle the board. Density is moderate: slips are generous, the bar is slim, and the decks column sits quiet beside the board.

**Key Characteristics:**
- Near-black tonal layers with hairline borders; gold is the only saturated voice outside zone tints.
- Two voices of type: Cinzel caps name and act, italic Garamond notes and explains.
- The slip is the unit: pinned, softly lifted, tinted by the state of the table.
- Zone colours carry meaning (waiting, under way, drafting) and are shared with the in-game board.
- Small, near-square corners (2-4px); only seats are round.

## Colors

A dark felt with one gold and three borrowed zone tints; everything else is grey.

### Primary
- **Table Gold** (`table-gold`): the primary button fill, focus rings, the pin, the invite code, the selection tint, and every hover-to-attention state. Shared with the board as `--accent`.
- **Table Gold, Lit** (`table-gold-lit`): primary hover only.
- **Lead Gold** (`table-gold-lead`): the one heavier gold reserved for the board's lead action, Start a table, with a brighter rim and a soft gold under-glow.
- **Tarnished Gold** (`tarnished-gold`): quiet gold for secondary hover borders, the ring around your own table, and the invite note's rim. Shared as `--accent-dim`.
- **Gold Ink** (`gold-ink`): text on any gold fill.

### Secondary (zone tints, shared with the in-game board)
- **Creature Green** (`creature-green`): a table waiting for players; also the live open-table count on sign-in and the open-count on the board header.
- **Artifact Amber** (`artifact-amber`): a table under way.
- **Land Blue** (`land-blue`): a table drafting.
Each tint drives a slip's `--mh-tone` (format label, seat ring) plus a low-alpha vertical gradient fill and a 42%-alpha rim of the same hue.

### Neutral
- **Void Black** (`void-black`): page ground and field fill. Shared as `--bg-deep`.
- **Felt Black** (`felt-black`): bar and board-adjacent ground. `--bg-base`.
- **Panel Black** (`panel-black`): the decks column; slips run a #181818 to #111 gradient around it. `--bg-panel`.
- **Raised Black** (`raised-black`): row hover, empty art wells. `--bg-elev`.
- **Hairline Soft / Hairline** (`hairline-soft`, `hairline`): every divider and border; the stronger one on controls and the sign-in slip.
- **Bone / Ash / Smoke** (`bone-text`, `ash-text`, `smoke-text`): text at three strengths: names and values, notes and meta, hints and the disclaimer.
- **Blood Red** (`blood-red`) is the board's `--danger`; on the home surface error text and missing-card warnings use **Blood Red, Text** (`blood-red-text`) because the base red is too dark to read on void black.

### Named Rules
**The One Gold Rule.** Gold marks what you can act on, what is yours, and the mat's frame: the primary action, focus, the pin, your table's ring, the Start a table slip, and the 30%-gold rim around the noticeboard (the board's own mat is framed in gold the same way). It is never a flat fill for a panel.

**The Zone Colour Rule.** On the board, green, amber and blue are the creature, artifact/command and land zones; around the board they mean a table's state (waiting, under way, drafting). Use them for zones or table state only, never as decoration.

## Typography

**Display Font:** Cinzel (with serif fallback)
**Body Font:** EB Garamond (with Georgia, serif)

**Character:** Cinzel is an inscriptional capital face; lower-case renders as small caps, so it reads as engraved labels. EB Garamond carries the human voice, almost always italic on this surface.

### Hierarchy
- **Wordmark** (600, 1.7rem, 0.18em tracking): the sign-in wordmark; the bar's brand name uses the same treatment at 1.12rem.
- **Headline** (600, 1.02rem, 0.2em, uppercase): section heads, Tables and Your decks.
- **Title** (600, 1.08rem, 1.25, 0.06em): a table's name on its slip; the invite page's h1 runs 1.3rem at 0.14em.
- **Body** (400, 1rem, 1.35): field text runs 1.05rem; explanatory copy caps at 60ch.
- **Note** (400 italic, about 0.92-1.05rem, 1.3): table status, format, seat names, hints, counts, empty states, the account-sharing line. The format rides inline after a table's name in the zone colour.
- **Label** (600, 0.74rem, 0.14em, uppercase): every button; compact buttons step down to 0.64-0.68rem.
- **Field label** (400, 0.68rem, 0.16em, uppercase, ash): the caption above an input.
- **Code** (Cinzel, 0.78rem, 0.2em): room codes on slips; the join-by-code field sets typed codes at 0.28em.

### Named Rules
**The Two Voices Rule.** Cinzel names and acts; italic Garamond speaks. A sentence is never set in Cinzel, and a button is never set in Garamond, except the one underlined italic text link.

## Layout

Home is a slim sticky bar over a two-column main: the board of slips at `minmax(0, 1fr)` and a 340px decks column, 26px apart, capped at 1440px. The decks column is sticky under the bar. Slips fill an auto-fill grid of `minmax(240px, 1fr)` with 24px row and 18px column gaps (row gaps are larger to clear the pins); the Start a table slip is always first. Sign-in and invite are single centred slips (410px and 440px max).

Rhythm steps through 6, 10, 14, 22 and 28px: 6 between tight controls, 10-14 inside a slip, 22 between slips and around the board, 28 at page gutters.

Responsive: at 1080px the decks column narrows to 300px; at 860px the page becomes one column, the join-by-code field takes a full row in the bar, and slips stack. On coarse pointers every control grows to 44px, and deck row actions sit on their own line instead of floating in on hover.

## Elevation & Depth

Depth is mostly tonal, near-black stacked on near-black and separated by hairlines. Slips get one soft, low, dark drop shadow and a faint top-edge highlight, as if lying on the board. The board itself is recessed: an inner dark ring, a faint gold radial wash at the top, a long soft shadow under. Floating notices get a heavier diffuse shadow. There are no hard or offset shadows. The board's modal overlays dim and blur the table behind them (4-8px); home has no overlays of its own.

### Shadow Vocabulary
- **Slip rest** (`box-shadow: 0 14px 26px -16px rgba(0,0,0,0.95), inset 0 1px 0 rgba(255,255,255,0.035)`): every pinned slip.
- **Board recess** (`box-shadow: inset 0 0 0 1px rgba(0,0,0,0.7), 0 24px 50px -30px rgba(0,0,0,1)`): the noticeboard frame.
- **Lead glow** (`box-shadow: 0 8px 22px -12px rgba(212,175,111,0.8)`): the Start a table button only.
- **Yours ring** (`box-shadow: 0 0 0 1px var(--accent-dim), …slip rest`): a table you host.
- **Floating note** (`box-shadow: 0 14px 40px rgba(0,0,0,0.7)`): the invite note over the board.
- **Pin** (`filter: drop-shadow(0 3px 2px rgba(0,0,0,0.85))`).

### Named Rules
**The Lying-Flat Rule.** Shadows are soft and fall straight down. A slip lies on the board; nothing here floats off it except a transient notice.

## Shapes

Chrome corners are nearly square: 2px on controls and fields, 3px on slips, 4px on the board and panels. Card images are the exception the world owns: on the board they keep a card's rounded corners (6-8px). On the home surface the only round form is the seat pip, a 40px circle ringed in the table's tone; an empty seat is a dashed circle. Dashed lines mean "open": empty seats and the Start a table slip. The gold pin (Material Symbols, from the shared ojee.net icon set) sits centred on each slip's top edge and drops in on mount.

## Components

### Buttons
Tactile but restrained: tracked Cinzel caps in a near-square box.
- **Shape:** near-square (2px), 36px minimum, 44px on touch.
- **Primary:** gold fill, gold-ink text, 8px 16px. Gold at rest, not only on hover.
- **Lead:** Start a table only; full-width, 46px, lead gold with a brighter rim and the lead glow.
- **Ghost:** transparent with a hairline border; hover shifts border to tarnished gold, text to gold, and a 6% gold wash.
- **Text link:** italic Garamond, ash, underlined in 40% gold; for mode switches such as make an account.
- **Icon button:** 32px square, transparent until hover; the danger variant hovers red.
- **Focus:** 2px gold outline, 2px offset. Transitions are 0.15s on colour and border.

### Cards / Containers (the slip)
- **Corner Style:** 3px.
- **Background:** #181818 to #111 gradient by default; table slips layer their zone gradient over #0d0d0d; quiet (empty) tables fall back to grey.
- **Shadow Strategy:** slip rest (see Elevation).
- **Border:** hairline soft, or the zone rim at 42% alpha.
- **Internal Padding:** 22px 18px 16px; the foot is divided by a 6% white hairline and holds the room code, age and actions.

### Inputs / Fields
- **Style:** void-black fill, hairline border, 2px corner, 42px, Garamond 1.05rem; placeholders italic grey.
- **Focus:** border turns gold with a 3px 16%-gold halo.
- **Select:** native appearance removed; a small drawn chevron in smoke.
- **Error:** italic blood-red text below, announced as an alert.

### Navigation (the bar)
Sticky, 12px 28px, felt gradient with a soft hairline beneath. Logo and Cinzel brand name left, the version as an italic link, join-by-code (code field plus Sit down and Watch ghosts) pushed right, then you and sign out as icon buttons.

### Seat Pips (signature)
40px circles holding the seated commander's art crop, or a Cinzel initial; ringed 2px in the table's tone over a 1px black ring. Away seats go greyscale and dim; left seats fade to 40%; empty seats are dashed circles; overflow reads "N more open" in italic.

### Deck Row
64px art thumbnail and Cinzel name with an italic commander line; actions float over the end of the row on hover or focus behind a fade so names keep their width.

### Invite Note
A transient notice fixed under the room bar when you arrive at a table you started: tarnished-gold rim, #141210 fill, floating-note shadow. It either confirms the link was copied or hands over a selectable field and a Copy button.

## Do's and Don'ts

### Do:
- **Do** inherit the board's `:root` tokens (`--bg-*`, `--border*`, `--text*`, `--accent`, `--accent-dim`) and scope any new surface's styles under its own prefix, as home does with `.mh-`.
- **Do** keep primary actions gold at rest, and give each surface at most one lead action.
- **Do** tint anything that represents a table by its state using the zone colours, through a single `--mh-tone`.
- **Do** set notes, status and hints in italic Garamond and keep labels and buttons in tracked Cinzel caps.
- **Do** give every control 44px on coarse pointers and a 2px gold focus outline.
- **Do** keep the Wizards of the Coast disclaimer visible on every page, in smoke at 0.8rem.

### Don't:
- **Don't** restyle the in-game board or its menus from surface work; its layout is settled.
- **Don't** use zone colours for decoration; they belong to the board's zones and to table state.
- **Don't** use hard offset shadows; depth is soft, downward, and tonal. (The board's modal overlays blur what is behind them; that is the board's device for dimming the table, not a surface material.)
- **Don't** round chrome (controls, slips, panels) past 4px. Round things are seats; card images keep the card's own rounded corners (6-8px on the board), as a real card has them.
- **Don't** bring in icons outside the shared Material Symbols set, or display faces other than Cinzel.
- **Don't** set the base danger red as text on void black; use the lighter text red.
