import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

/*
 * Paged how-to-play / controls guide. Not shown automatically — the user opens
 * it via the "Guide" button in the topbar. Navigable with on-screen arrows,
 * keyboard arrows, or the page-dots at the bottom.
 *
 * Content is intentionally grouped by "thing you'd want to do right now" rather
 * than by feature area, so someone dropped into a game can scan the relevant
 * page and get back to playing.
 */

const PAGES = [
    {
        title: 'Welcome',
        body: (
            <>
                <p className="guide-lede">
                    This is an unofficial digital tabletop for Commander / EDH. It's a tool,
                    not a rules engine — you move cards, change life totals, and draw stuff
                    however your playgroup actually plays.
                </p>
                <p className="guide-disclaimer">
                    Magic: The Gathering is a trademark of Wizards of the Coast. This project is not produced, endorsed, or supported by Wizards of the Coast. Card data from Scryfall. Deck import via Moxfield.
                </p>
                <p>
                    Quick start: <strong>Load Deck</strong> in the topbar, then
                    <strong> Start Game</strong> once everyone's loaded. A random player
                    goes first and each player draws 7 cards.
                </p>
                <p className="guide-tip">
                    Use the arrows below or <kbd>←</kbd> <kbd>→</kbd> to flip through
                    these pages. Press <kbd>Esc</kbd> to close.
                </p>
            </>
        ),
    },
    {
        title: 'Your zones',
        body: (
            <>
                <p>Every player's area shows the standard MTG zones:</p>
                <ul>
                    <li><strong>Battlefield</strong> — split into Creatures, Artifacts/Enchantments, Lands, and the Command Zone. Right-click a card to force it into a different row.</li>
                    <li><strong>Hand</strong> — only you see your own hand. Opponents see a back-of-card count.</li>
                    <li><strong>Library</strong> — click the label to view it alphabetically. Use <em>Tutor</em> to search and pull a card.</li>
                    <li><strong>Graveyard / Exile</strong> — click to expand and see contents.</li>
                    <li><strong>Command Zone</strong> — your commander lives here; move it to the battlefield when you cast.</li>
                </ul>
            </>
        ),
    },
    {
        title: 'Moving cards',
        body: (
            <>
                <p><strong>Drag and drop</strong> cards between zones. You can only drag your own cards.</p>
                <p><strong>Right-click</strong> a card for a context menu with Move, Tap, Flip, Face-down, Reveal, and more.</p>
                <p><strong>Click a card</strong> to maximize and view its oracle text + counters.</p>
                <p>
                    On touch devices, tap selects cards and a sticky toolbar at the bottom
                    takes the place of the right-click menu. Tap again to deselect.
                </p>
                <p className="guide-tip">
                    Shift-click (or ctrl-click / cmd-click) cards to multi-select and use
                    the bulk action bar to move them together.
                </p>
            </>
        ),
    },
    {
        title: 'Life, counters, damage',
        body: (
            <>
                <p><strong>Life total</strong> — click the number to edit, or use + / - to adjust. Type <kbd>∞</kbd> or <em>inf</em> for infinite life. Works for any player (opponents too, for when you deal damage).</p>
                <p><strong>Player counters</strong> (poison, energy, experience) are in the player context menu — right-click a player name. Click a counter badge to increment, right-click to decrement.</p>
                <p><strong>Commander damage</strong> — right-click a player → "Cmdr Dmg from X". This reduces their life total as well. Also accepts <em>∞</em>.</p>
                <p><strong>Card counters</strong> (+1/+1, -1/-1, custom) — right-click a card → Add Counter, or use the sticky toolbar on touch.</p>
                <p className="guide-tip">
                    All game values (life, infect, cmdr damage, counters) accept
                    "∞" / "inf" for infinite combos. Math on infinite values still
                    works — infinite minus any number is still infinite.
                </p>
            </>
        ),
    },
    {
        title: 'Turns & phases',
        body: (
            <>
                <p><strong>Mulligan phase</strong>: after Start Game, every player draws 7 and can mulligan freely (7 → 7 → 6 → 5). Each player clicks <strong>Ready</strong> in the topbar when they're done. Once everyone is ready, the server rolls a d20 for each player — highest roll takes turn 1, with the rolls shown as toasts so the whole table sees what happened.</p>
                <p>The <strong>turn indicator</strong> in the topbar shows whose turn it is. Only the <em>current turn player</em> (or the host) can press <strong>End Turn</strong>.</p>
                <p>Dead/eliminated players (life ≤ 0, 21+ commander damage, 10+ poison) are <em>automatically skipped</em> on turn advance.</p>
                <p><strong>Turn-start nudges</strong>: on your turn, the Draw button glows amber until you draw, and any land card in your hand glows until you drop your first land. Purely visual reminders — nothing is enforced, just hard to forget your land drop.</p>
                <p><strong>Auto-untap</strong> runs at the start of your turn by default. You can turn it off per-player via the player context menu — useful for effects like "doesn't untap during your untap step". Auto-untap events appear in the action log (italic/faint) so you can always see what happened.</p>
                <p><strong>Undo</strong> reverts the last mutating action (30 deep). Custom designations (Monarch, Initiative, City's Blessing, Day/Night) are in the player context menu — visual only, no automatic triggers.</p>
            </>
        ),
    },
    {
        title: 'Drawing on the board',
        body: (
            <>
                <p>The pencil icon on the <strong>left edge</strong> toggles free-hand drawing. Use it to point at things, draw arrows, circle blockers, mark combat tricks, etc.</p>
                <p>Toolbar has a <strong>pen</strong> and <strong>eraser</strong>. The eraser removes strokes under the cursor; the pen draws in your chosen color/size. <em>Clear Mine</em> removes only your strokes; <em>Clear All</em> wipes the board.</p>
                <p>Drawings sync live across desktop and mobile in the same room. While the pen is active, your <strong>shared cursor</strong> also recolors to match your brush so other players can see who's drawing what. Press <kbd>Esc</kbd> to exit drawing mode.</p>
            </>
        ),
    },
    {
        title: 'Chat, log, cursors & spectators',
        body: (
            <>
                <p>The <strong>chat icon</strong> on the right edge opens a sidebar for table talk. Both players and spectators can type.</p>
                <p>The <strong>Log</strong> button in the topbar (or the burger icon on the right edge) opens the <strong>action log</strong> — a running feed of every action in the room including turn start/end, auto-untap, opening draws, mulligans, and victory. Visible to everyone, including spectators who joined late.</p>
                <p><strong>Live cursors</strong>: desktop players who aren't in compact mode see each other's mouse pointers in real time (with a small username label). Toggle it per-user via the <em>Cursor</em> checkbox in the topbar. Touch devices and compact-mode users don't participate — their layouts don't line up.</p>
                <p>
                    Spectators join via the lobby's <strong>Spectate</strong> button or by
                    clicking an invite link and picking <em>Spectate</em>. They see every
                    player's hand, but can't interact — only chat and point with the cursor.
                    The topbar shows "👁 N watching"; click it to see their usernames.
                </p>
                <p>To reveal your hand to a specific person, right-click your own player name → "Reveal hand to X". Revealing "to all" sends to every other player but not yourself.</p>
            </>
        ),
    },
    {
        title: 'Inviting friends',
        body: (
            <>
                <p>When you create a room, an <strong>invite link</strong> is copied to your clipboard automatically. Paste it anywhere (Discord, SMS, etc.) — opening the link takes the recipient to a <em>role picker</em>: they choose <strong>Join as Player</strong> or <strong>Join as Spectator</strong> before actually entering the room.</p>
                <p>The room code in the topbar is hidden by default. Click it once to reveal, click again to copy the invite link.</p>
                <p>Leaving a room returns you to the lobby. Your session is remembered — refreshing the page drops you back into the same room in the same role.</p>
            </>
        ),
    },
    {
        title: 'Decks & custom cards',
        body: (
            <>
                <p><strong>Build / import / view decks from anywhere</strong> — in the lobby under "My Decks", or inside a room via the <em>Load Deck</em> modal. Every deck list has <em>Build New</em>, <em>Import</em>, and per-deck <em>View</em> / <em>Edit</em> actions.</p>
                <p><strong>Moxfield import</strong>: open your deck on Moxfield → More → Export → <strong>Copy as plain text</strong> (not "Copy for Moxfield" — plain text is more reliable, fewer missing cards). Paste into Import → Paste Text tab. The "Moxfield URL" tab is disabled because Moxfield's API is Cloudflare-protected and blocks both server-side and cross-origin access — there's no way around it without OAuth.</p>
                <p><strong>Custom cards</strong> — create them from the lobby's <em>Custom Cards</em> button, or from the Custom Cards tab inside Deck Builder. They show up in any deck you build. Editing a custom card propagates the change to every deck that uses it — yours AND any friend who imported your deck in link mode.</p>
                <p><strong>Sharing decks</strong> — click the share icon next to a deck to generate a short 8-character share code. The recipient opens <strong>Import</strong> → <strong>Share Code</strong>, pastes it, and picks how to handle custom cards:</p>
                <ul>
                    <li><strong>Copy</strong> (default): custom cards become new records owned by the importer. They can edit independently — the sharer's future edits don't reach them.</li>
                    <li><strong>Link</strong>: the deck references the original author's custom cards directly. When the author edits, the linked deck auto-updates.</li>
                </ul>
                <p><strong>Author visibility</strong> — the deck viewer, deck list, and maximized card view all show who created a custom card ("by &lt;username&gt;"). Imported decks show "shared by &lt;username&gt;" in the deck list.</p>
            </>
        ),
    },
    {
        title: 'Mana pool & lands',
        body: (
            <>
                <p>Right-click a basic land on your battlefield → <strong>Tap for mana</strong>. The land taps and a colored pip appears in your <strong>mana pool widget</strong> in your player header.</p>
                <p>For a non-basic land (shockland, dual, tap-land), the same action opens a small <strong>mana picker</strong> — click the colors that land produces (e.g. W and G for a Stomping Ground). The land taps and the chosen mana goes into your pool.</p>
                <p>Click a pool pip to <strong>spend</strong> one of that color (subtract). Shift-click to add one back if you misclicked. The <strong>×</strong> at the end empties the pool. The pool also clears automatically at the start of your next turn.</p>
                <p className="guide-tip">The mana pool is a tool, not a payment system — nothing forces you to actually spend mana to cast a spell. It just helps you remember what you've floated.</p>
            </>
        ),
    },
    {
        title: 'New card actions (right-click)',
        body: (
            <>
                <p>Every battlefield card now has a richer right-click menu:</p>
                <ul>
                    <li><strong>Mark damage</strong> — opens a small modal, sets a red badge in the corner. Clears at end of turn for everyone, automatically.</li>
                    <li><strong>Suspend counters</strong> — purple ⌛ badge. Auto-decrements at the start of the suspended player's next turn; the action log says "X is ready to cast" when it hits 0.</li>
                    <li><strong>Phase out / Phase in</strong> — visually fades the card. Doesn't actually exempt anything from targeting (no rules engine), it's just the marker.</li>
                    <li><strong>Goad / Remove goad</strong> — orange ⚔ badge.</li>
                    <li><strong>Clone (token)</strong> — duplicates the card as a token-marked copy.</li>
                    <li><strong>Take control (until EOT)</strong> on opponents' cards — moves the card to your battlefield with a blue ring. End your turn and it goes back automatically.</li>
                </ul>
                <p>For cards in the graveyard / exile / foretell zones: <strong>Cast → battlefield</strong> moves it back. <strong>Cast → exile after</strong> moves it back AND tags the action log so you remember to send it to exile when it dies (for flashback / escape / jump-start / unearth).</p>
                <p>For cards in your hand: <strong>Foretell</strong> moves them to a face-down foretell pile. The Foretell zone strip only shows when you actually have something there.</p>
            </>
        ),
    },
    {
        title: 'Stack, extra turns, emblems, proliferate',
        body: (
            <>
                <p><strong>The stack</strong> — when something is on the stack (pushed via the action menu or future "cast spell" wiring), a panel appears at the top of the screen showing the entries with the top one highlighted. Click <strong>Resolve</strong> on the top entry to pop it, or <strong>Clear</strong> to wipe the stack.</p>
                <p><strong>Extra turns</strong> — right-click any player → <em>Queue extra turn</em>. A "↺ N: name" indicator appears in the topbar. The next time turns advance, the queue head plays first instead.</p>
                <p><strong>Emblems</strong> — right-click your own player → <em>Add emblem...</em> → name + effect text. The Emblems strip only renders when non-empty. You can also add an emblem to an opponent (for cards that say "your opponent gets an emblem with...").</p>
                <p><strong>Proliferate</strong> — right-click your own player → <em>Proliferate</em> → +1 to every existing counter on every permanent and player. The action log tells you how many counters were affected.</p>
            </>
        ),
    },
    {
        title: 'Game settings (⚙)',
        body: (
            <>
                <p>The new <strong>⚙</strong> button in the topbar opens a Settings modal. The host can change everything live, mid-game:</p>
                <ul>
                    <li><strong>Format presets</strong>: commander, brawl, modern, oathbreaker, free — picking one fills in starting life and commander damage.</li>
                    <li><strong>Numbers</strong>: starting life, commander damage lethal, max players, hand-size limit.</li>
                    <li><strong>Mulligan rules</strong>: Vancouver (legacy 7→7→6→5), London (always draw 7, bottom N), or Free 7 (free first mull).</li>
                    <li><strong>Shared team life</strong> — when ON, every life change to a player on a team propagates to every teammate so the team is one number.</li>
                    <li><strong>My team ID</strong> — assign yourself to a team. Combine with shared life and team victory.</li>
                    <li><strong>Avatar color</strong> — your color dot in the player header.</li>
                </ul>
                <p>Non-host players see the modal in read-only mode for everything except their own team ID + avatar color.</p>
            </>
        ),
    },
    {
        title: 'Hand & library tools',
        body: (
            <>
                <p><strong>Reveal SPECIFIC cards from hand</strong> — right-click your own player → <em>Reveal SPECIFIC cards from hand</em>. Click cards in your hand to pick which to show, then choose a target (all players or one specific opponent).</p>
                <p><strong>Browse opponent's library</strong> — right-click an opponent → <em>Browse full library</em>. Searchable list of every card; click a card to view it, click <strong>Take</strong> to pull it to your battlefield (Bribery / Acquire).</p>
                <p><strong>Direct messages in chat</strong> — open the chat panel and pick a target from the new dropdown above the input. DMs are marked with → and a blue left border, only delivered to sender + recipient.</p>
                <p><strong>Concede</strong> — right-click your own player → <em>Concede</em>. You go to 0 life, your seat is treated as eliminated, and the victory check fires for the remaining players.</p>
                <p><strong>Hand-size enforce</strong> — toggle in your own player menu. When ON, ending a turn with too many cards triggers a notification (it's a nudge, not auto-discard).</p>
            </>
        ),
    },
    {
        title: 'Tips & shortcuts',
        body: (
            <>
                <ul>
                    <li><kbd>Esc</kbd> closes the topmost modal or clears selection / exits drawing mode</li>
                    <li><kbd>Enter</kbd> in chat sends, <kbd>Shift+Enter</kbd> is a newline</li>
                    <li>Hover a card on desktop for a zoomed preview + counters / notes panel</li>
                    <li>A single <strong>Flip</strong> action on every card — swaps sides on double-faced cards (MDFCs, Werewolves), toggles face-down on regular cards. One button handles both cases</li>
                    <li>When you tutor a card into your library via <strong>View Deck → Lib…</strong>, you can choose an exact position (0 = top, N = bottom, or "top"/"bottom")</li>
                    <li>The <strong>Shuffle after</strong> checkbox in View Deck is now off by default — turn it on for effects like "tutor then shuffle"</li>
                    <li>Use <strong>Custom</strong> to make a token or fake card on the fly; save it to your library via the lobby's Custom Cards manager</li>
                    <li><strong>Background (BG)</strong> sets a background image for your side of the board</li>
                    <li><strong>Middle-click</strong> any card to tap/untap it instantly</li>
                    <li><strong>Ctrl+drag</strong> across cards to paint-select multiple at once</li>
                    <li><strong>Shift+click</strong> "→ Top Lib" or "→ Bot Lib" to randomize the order</li>
                    <li><strong>Shift+click</strong> an alternate art in the skin picker to apply to all copies + save to deck</li>
                    <li>Player counter badges: <strong>click</strong> +1, <strong>right-click</strong> -1, <strong>middle-click</strong> removes</li>
                    <li>Drawing now shows a <strong>brush preview circle</strong> at your cursor; <strong>Hide</strong> button hides all drawings without erasing</li>
                    <li>The new <strong>conditional zones</strong> (Foretell, Sideboard, Wishboard, Emblems) only appear when they have content</li>
                    <li>The mana pool empties automatically at the start of your next turn</li>
                    <li>Eliminated and conceded players are skipped automatically on turn pass</li>
                    <li>Custom dice: the Roll modal now supports d2, d3, and any custom number of sides</li>
                </ul>
                <p>When one player (or one team) is the last surviving group, a 🏆 victory animation fires for the whole table.</p>
                <p className="guide-tip">
                    If anything gets weird, <strong>Undo</strong> is your friend. If it's really
                    stuck, leaving and rejoining the room restores the last server state.
                </p>
            </>
        ),
    },
];

export default function Guide({ onClose }) {
    const [page, setPage] = useState(0);
    const total = PAGES.length;

    const go = (delta) => setPage(p => Math.max(0, Math.min(total - 1, p + delta)));

    useEffect(() => {
        const handler = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
            if (e.key === 'ArrowLeft') { e.stopPropagation(); go(-1); return; }
            if (e.key === 'ArrowRight') { e.stopPropagation(); go(1); return; }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onClose]);

    const current = PAGES[page];

    return createPortal(
        <div className="modal-overlay guide-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal guide-modal">
                <div className="modal-header">
                    <h2>Guide · {current.title}</h2>
                    <button className="close-btn" onClick={onClose} type="button">x</button>
                </div>

                <div className="guide-body">
                    {current.body}
                </div>

                <div className="guide-footer">
                    <button
                        className="guide-arrow"
                        onClick={() => go(-1)}
                        disabled={page === 0}
                        type="button"
                        aria-label="Previous page"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <div className="guide-dots">
                        {PAGES.map((p, i) => (
                            <button
                                key={i}
                                className={`guide-dot ${i === page ? 'active' : ''}`}
                                onClick={() => setPage(i)}
                                title={p.title}
                                type="button"
                                aria-label={`Go to page ${i + 1}: ${p.title}`}
                            />
                        ))}
                    </div>
                    <button
                        className="guide-arrow"
                        onClick={() => go(1)}
                        disabled={page === total - 1}
                        type="button"
                        aria-label="Next page"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
