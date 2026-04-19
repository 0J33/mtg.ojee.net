// Changelog — chronological list of versions and what changed.
// Keep this updated whenever you ship a new version.
// Newest version goes at the TOP.

export const CHANGELOG = [
    {
        version: '2.7',
        date: '2026-04-19',
        changes: [
            'Fix Flip button — previously silently failed for cards in piles (server only searched player zones); now works everywhere',
            'Piles: new "Private" option — only the creator sees the cards; others see nothing. Toggle from the create row or the pile header (lock icon)',
            'Private piles are fully hidden from other players; only the owner can add/remove cards, rename, shuffle, or delete',
            'Piles: face-down cards now show the actual card back (was rendering a broken image)',
            'Piles: pile name / rename inputs now use proper dark-on-light styling (were unreadable white-on-white)',
            'Delete pile now uses a styled confirm modal instead of the browser alert, with proper z-index above the panel',
        ],
    },
    {
        version: '2.6',
        date: '2026-04-19',
        changes: [
            'Piles panel is draggable — grab the header (grip icon on the left) to move it anywhere on screen; works on desktop and mobile',
            'Position persists per browser; a reset button appears in the header once moved',
            'On mobile, dragging turns the panel into a floating window instead of full-screen so you can reach zones underneath',
            'Fix broken pile action icons (rename / shuffle / delete were showing literal escape text); replaced with proper SVG icons',
        ],
    },
    {
        version: '2.4 – 2.5',
        date: '2026-04-19',
        changes: [
            'Shared piles — click the piles icon on the left edge to open. Any player can create, name, rename, shuffle, delete piles, and drag cards in/out',
            'Piles are visible to everyone; drag cards into a pile from any zone, drag them back out, or use the context menu "Move to pile: <name>"',
            'Counter modal: new "Until end of turn" checkbox — counter clears automatically at end of turn cleanup',
            'Foil / alternate art / textless flag are now OWNER-ONLY edits (others can see the effect but not change it)',
            'CardMaximized now shows the owner\u2019s chosen alternate art (was only shown on the battlefield thumbnail)',
            'If rotated 180° on the board, CardMaximized also rotates',
            'Fix counter modal: Add/Set buttons work from right-click menu; raised above CardMaximized so "Add counter" from maximize view is visible',
            'Fix player header right-click: counters and cmd damage badges no longer pop the browser\u2019s right-click menu or bubble to the player menu',
        ],
    },
    {
        version: '2.3',
        date: '2026-04-15',
        changes: [
            'Etched foil effect — metallic border shimmer, subtler than regular foil',
            'Context menu: separate Make foil / Make etched / Remove effect options',
            'Deck builder foil button cycles: none → foil → etched → none',
            'Moxfield import detects etched finish separately from foil',
        ],
    },
    {
        version: '2.2',
        date: '2026-04-14',
        changes: [
            'Counter modal: separate Add and Set buttons (Add deltas the current value, Set replaces it)',
            'Multi-select Flip works — flips each selected card (DFC swap or face-down toggle per-card)',
            'Multi-select counter modal shows "· N cards" in header',
        ],
    },
    {
        version: '2.1',
        date: '2026-04-14',
        changes: [
            'Deck builder: foil toggle + alternate art picker per card (saves to deck)',
            'CardMaximized: foil toggle button in quick actions',
            'Context menu: foil works in all zones (not just battlefield)',
            'Moxfield import: detects isFoil / finish=foil and marks cards as foil',
        ],
    },
    {
        version: '2.0',
        date: '2026-04-14',
        changes: [
            'Fix Moxfield token import — tokens now get correct art by batch-fetching from Scryfall\u2019s collection API',
        ],
    },
    {
        version: '1.99',
        date: '2026-04-14',
        changes: [
            'Keyword tooltips — hover/maximize a card to see reminder text for its keywords (Flying, Trample, Deathtouch, etc.)',
            'Foil cards — right-click a card on the battlefield → "Make foil" for a holographic shimmer effect',
            'Fix maximize view overflow — long effect lists now scroll instead of getting clipped',
        ],
    },
    {
        version: '1.98',
        date: '2026-04-14',
        changes: [
            'Changelog — click the version number in the lobby to see what changed',
        ],
    },
    {
        version: '1.97',
        date: '2026-04-14',
        changes: [
            'Battlefield layout: creatures/artifacts row on top, command zone/lands on bottom (matches physical MTG)',
            'Mana pool numbers use pastel colors matching MTG symbol hues (always visible)',
            'Draft setup UI fixes: wider pack count field, styled select dropdown',
        ],
    },
    {
        version: '1.96',
        date: '2026-04-14',
        changes: [
            'Fix tournament bracket crash (argument order + missing actionHistory init)',
            'Basic land art fallback — uses Foundations set if draft set has no basics',
        ],
    },
    {
        version: '1.95',
        date: '2026-04-14',
        changes: [
            'Tournament bracket — single-elimination with random seeding',
            'Match result reporting (host or either player can report winner)',
            'Victory animation for tournament champion',
        ],
    },
    {
        version: '1.94',
        date: '2026-04-14',
        changes: [
            'Basic lands in draft deck builder use set-matching art from Scryfall',
        ],
    },
    {
        version: '1.93',
        date: '2026-04-14',
        changes: [
            'Format-aware zones: commander zone + commander damage hidden for non-commander formats',
            'Commander damage lethality check gated by format',
        ],
    },
    {
        version: '1.92',
        date: '2026-04-14',
        changes: [
            'Hover zoom on draft pack cards and picked cards',
            'Reconnect restores draft state (current pack, picks, pool)',
            'Fix: draftState now included in game state broadcast',
        ],
    },
    {
        version: '1.90 – 1.91',
        date: '2026-04-14',
        changes: [
            'Visual draft flow with pack opening animation (set icon + shimmer)',
            'Card reveal animation (staggered cascade)',
            'Basic lands section in deck builder with +/- buttons',
            'Clearer set selection indicator in draft setup',
        ],
    },
    {
        version: '1.89',
        date: '2026-04-14',
        changes: [
            'Rebrand from "MTG Commander" to "mtg.ojee.net" (format-neutral)',
            'MIT license with third-party content disclaimer',
        ],
    },
    {
        version: '1.88',
        date: '2026-04-13',
        changes: [
            'Sealed mode: generate pools per player, deck builder with main/pool panels',
            'Draft mode: packs open, picks pass left/right alternating per round',
            'Server-side pack generator using Scryfall (1 rare, 3 uncommons, 10 commons, 1 basic)',
        ],
    },
    {
        version: '1.87',
        date: '2026-04-13',
        changes: [
            'Deck builder: edit Moxfield source URL',
            'Deck builder: manage tokens (search & add, remove)',
        ],
    },
    {
        version: '1.86',
        date: '2026-04-13',
        changes: [
            'Add format presets: standard, legacy, vintage, pauper, draft',
        ],
    },
    {
        version: '1.84 – 1.85',
        date: '2026-04-13',
        changes: [
            'Fix drawing toolbar layout on mobile',
            'Fix skin button spacing in card maximize view',
        ],
    },
    {
        version: '1.82 – 1.83',
        date: '2026-04-13',
        changes: [
            'Touch drag-and-drop for Android (long-press 300ms)',
            'Floating ghost follows finger, zones highlight on hover',
            'Suppress Android context menu + iOS synthetic click after drop',
        ],
    },
    {
        version: '1.81',
        date: '2026-04-13',
        changes: [
            'Replace all close/delete buttons with inline SVGs (no more background-image hack)',
            'Updated Guide with touch modes, timers, skins, tokens',
        ],
    },
    {
        version: '1.77 – 1.80',
        date: '2026-04-13',
        changes: [
            'Polish touch mode buttons: match chat/draw toggle size, bigger icons, better visibility',
            'Fix close button hover flicker',
        ],
    },
    {
        version: '1.73 – 1.76',
        date: '2026-04-13',
        changes: [
            'Touch modes on mobile: Normal (view), Select (multi-select), Menu (context menu)',
            'Floating mode toggle buttons bottom-left',
            'Fix touch detection reliability',
            'SVG icons everywhere (close X, guide arrows, collapse chevrons, delete)',
        ],
    },
    {
        version: '1.72',
        date: '2026-04-13',
        changes: [
            'Collapsible command zone',
            'Mobile navbar horizontally scrollable',
            'Zone label truncation (ellipsis) for long names',
        ],
    },
    {
        version: '1.70 – 1.71',
        date: '2026-04-13',
        changes: [
            'Optimistic updates for tap/untap and life changes (no more lag on high ping)',
            'Leave button visible on mobile',
            'Guide + FEATURES docs updated',
        ],
    },
    {
        version: '1.68 – 1.69',
        date: '2026-04-13',
        changes: [
            'Deck viewer shows total + unique card count',
            'Moxfield source link displayed in deck viewer',
            'Tokens visible in deck viewer',
            'Several mobile UI fixes',
        ],
    },
    {
        version: '1.63 – 1.67',
        date: '2026-04-13',
        changes: [
            'Clockwise seating — you always at bottom, opponents above in turn order',
            'Bottom row reversed for 4+ players',
            'Compact mode respects clockwise ordering',
        ],
    },
    {
        version: '1.59 – 1.62',
        date: '2026-04-13',
        changes: [
            'Game timer, turn timer, cumulative per-player turn time',
            'Server-authoritative timers with client fallback',
            'Staleness watchdog — client requests full state if no update in 10s',
            'Disclaimers for WotC trademark, Scryfall, Moxfield',
        ],
    },
    {
        version: '1.50 – 1.58',
        date: '2026-04-12',
        changes: [
            'Deck tokens — import from Moxfield, quick-spawn from token menu',
            'Alternate art picker from Scryfall',
            'Save custom skins to deck',
            'Custom dice (d2, d3, any N)',
            'Chat/log persistence fix',
            'Card border-radius + centering improvements',
            'Scrollable context menus with smart positioning',
        ],
    },
    {
        version: '1.40 – 1.49',
        date: '2026-04-12',
        changes: [
            'Share copies URL (auto-opens import modal)',
            'Broadcast optimization: debounce, trimmed payloads, append-only action log',
            'Shift+click library buttons for random order',
            'Hover zoom on skin thumbnails',
            'Bulk move to top/bottom of library',
        ],
    },
    {
        version: '1.32 – 1.39',
        date: '2026-04-12',
        changes: [
            'Version display in lobby + topbar',
            'Fixed-height guide modal (arrows don\u2019t shift)',
            'Saved backgrounds gallery',
            'mtg.png logo in lobby + topbar',
            'Escape closes chat/log',
            'Hide drawings toggle',
            'Open Graph meta tags for Discord/Slack embeds',
        ],
    },
    {
        version: '1.0 – 1.31',
        date: '2026-04-11',
        changes: [
            'Server-side custom skins (visible to all players, save to deck)',
            'Cursor color syncing, white text on dark cursors',
            'Middle-click tap/untap',
            'View other side of DFC/MDFC cards',
            'Ctrl+drag multi-select',
            'Interactive proliferate (per-counter picker)',
            'Rotate 180° cards',
            'Search hover zoom z-index fix',
        ],
    },
    {
        version: 'Big batch (pre-1.0)',
        date: '2026-04-10',
        changes: [
            'Mana pool with tap-for-mana and mana picker modal',
            'Stack, extra-turn queue, emblems, proliferate',
            'Clone, foretell, cast-from-grave, take control',
            'Damage / phasing / suspend / goad markers',
            'Concede, hand-size enforcement',
            'Format presets: commander, brawl, modern, oathbreaker, free',
            'London / Vancouver / Free7 mulligan rules',
            'Team support with shared life + team victory',
            'Moxfield URL import (rate-limited API)',
            'Deck share codes (copy vs link mode)',
            'Two-step pick-target for attach/attack/reveal',
            'Equip/attach with visual link + hover panel',
        ],
    },
    {
        version: 'v0.1 – v0.8 (foundation)',
        date: '2026-04-09',
        changes: [
            'Initial commit — MTG Commander online tabletop',
            'Real-time multiplayer (Socket.io), MongoDB state',
            'Card zones, drag-and-drop, life totals, counters',
            'Chat, spectators, action log, drawing with eraser',
            'Invite links with player/spectator role picker',
            'Custom cards with origin system + deck share import',
            'Live cursor sharing with aspect-ratio-aware letterboxing',
            'Mobile responsive layout with sticky touch toolbar',
        ],
    },
];
