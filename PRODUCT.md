# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner and his friend group. They play Magic together in the browser, mostly on a laptop or desktop while talking in a voice call (Discord or similar); some join or play from a phone. It is not a public service: strangers are not an audience it is built for.

## Product Purpose

A shared Magic: The Gathering table in the browser. Someone makes a room, shares the invite link, everyone brings a deck and plays: commander, standard, modern, legacy, vintage, pauper, oathbreaker, draft and sealed. Success is a game night that starts in minutes and never stalls on "the app can't do that".

## Positioning

A table, not a rules engine. Cards are dragged, flipped, tapped, countered and drawn on freely; the rules live with the players and the voice call. Anything a real table can express, this one can.

## Operating Context

- A session starts with one player creating a room and pasting the invite link into chat; others join as players or spectators.
- Decks are built, imported (Moxfield URL, pasted text, share codes) and fixed up in the lobby before the game, sometimes mid-game.
- Typical game: a 3-5 player commander pod lasting an hour or more, everyone in a voice call.
- Players move between mtg.ojee.net and its sibling dnd.ojee.net with one account.

## Capabilities and Constraints

- Rooms with 6-character codes and invite links; player and spectator seats; draft and sealed flows; teams; custom cards; deck sharing.
- Accounts are shared with dnd.ojee.net: one username and password, and signing in or out on either site applies to both (decided 2026-09-22).
- Open rooms are listed for every signed-in player (join a waiting room, spectate a running one); a host can mark a room private so it only opens by invite (decided 2026-09-22).
- A room with nobody connected for an hour is closed and its members removed (decided 2026-09-22).
- Card data and images come from Scryfall; Moxfield import is rate-limited through a single queue.
- Fine for a handful of rooms at once on one home server; not built for scale.
- Magic names, card images and symbols are Wizards of the Coast IP; the unofficial-fan-project disclaimer must stay visible.

## Brand Commitments

- Name: mtg.ojee.net, written lower-case; the README's voice is casual and lower-case.
- The in-game board layout is settled and liked by the players; other work must not disturb it.
- Icons come from the one generated Material Symbols set shared across the ojee.net sites; the logo is the gold wizard's hat (`client/public/mtg-logo.svg`).

## Evidence on Hand

- Real card art and data via Scryfall at runtime; the changelog (`client/src/changelog.js`) and feature catalog (`FEATURES.md`).
- No testimonials, player counts, or usage stats exist; none may be invented.

## Product Principles

- The table never plays for you: tools, not enforcement.
- Getting into a game takes seconds: rooms are one click to make and one click to join.
- The board is sacred: changes around it must not cost anyone their muscle memory mid-game.
- Built for one friend group's pods, at their scale.
