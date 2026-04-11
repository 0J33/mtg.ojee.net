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
                    This is a digital tabletop for Commander / EDH. It's a tool, not a
                    rules engine — you move cards, change life totals, and draw stuff
                    however your playgroup actually plays.
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
                <p>The <strong>turn indicator</strong> in the topbar shows whose turn it is. Only the <em>current turn player</em> (or the host) can press <strong>End Turn</strong>.</p>
                <p>Dead/eliminated players (life ≤ 0, 21+ commander damage, 10+ poison) are <em>automatically skipped</em> on turn advance.</p>
                <p><strong>Auto-untap</strong> runs at the start of your turn by default. You can turn it off per-player via the player context menu — useful for effects like "doesn't untap during your untap step".</p>
                <p><strong>Mulligans</strong> follow the sequence 7 → 7 → 6 → 5, then no more. After drawing your initial 7, you can mulligan up to 3 times total.</p>
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
                <p>Drawings sync live across desktop and mobile in the same room. Press <kbd>Esc</kbd> to exit drawing mode.</p>
            </>
        ),
    },
    {
        title: 'Chat, log & spectators',
        body: (
            <>
                <p>The <strong>chat icon</strong> on the right edge opens a sidebar for table talk. Both players and spectators can type.</p>
                <p>The <strong>Log</strong> button in the topbar (or the burger icon on the right edge) opens the <strong>action log</strong> — a running feed of every mutating action in the room, including turn start/end. Visible to everyone, including spectators who joined late.</p>
                <p>
                    Spectators join via the lobby's <strong>Spectate</strong> button with
                    a room code. Spectators see every player's hand, but can't interact —
                    only chat. The topbar shows "👁 N watching" when spectators are
                    present; click it to see their usernames.
                </p>
                <p>To reveal your hand to a specific person, right-click your own player name → "Reveal hand to X".</p>
            </>
        ),
    },
    {
        title: 'Inviting & sharing decks',
        body: (
            <>
                <p>When you create a room, an <strong>invite link</strong> is copied to your clipboard automatically. Paste it anywhere (Discord, SMS, etc.) — opening the link auto-joins the room.</p>
                <p>The room code in the topbar is hidden by default. Click it once to reveal, click again to copy the invite link.</p>
                <p><strong>Sharing decks</strong>: in the lobby, click the <em>share</em> icon next to a deck to generate a short 8-character share code (copied to clipboard). Send it to a friend — they open <strong>Import</strong> → <strong>Share Code</strong> tab and paste it to get the full deck, including any custom cards you used. Custom cards have their own share codes too, via the <strong>Custom Cards</strong> manager.</p>
                <p>Leaving a room returns you to the lobby. Your session is remembered — refreshing the page drops you back into the same room in the same role.</p>
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
                    <li>Double-faced cards (MDFCs, Werewolves) show a single "Flip" action that swaps sides. Regular cards show "Face down/up" instead</li>
                    <li>When you tutor a card into your library via <strong>View Deck → Lib…</strong>, you can choose an exact position (0 = top, N = bottom, or "top"/"bottom")</li>
                    <li>The <strong>Shuffle after</strong> checkbox in View Deck is now off by default — turn it on for effects like "tutor then shuffle"</li>
                    <li>Use <strong>Custom</strong> to make a token or fake card on the fly; save it to your library via the lobby's Custom Cards manager</li>
                    <li><strong>Background (BG)</strong> sets a background image for your side of the board</li>
                </ul>
                <p>When one player is the last survivor, a 🏆 victory animation fires for the whole table.</p>
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
                        ◀
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
                        ▶
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
