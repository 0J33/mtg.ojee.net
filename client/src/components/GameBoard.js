import React, { useState, useCallback, useEffect, useRef } from 'react';
import socket from '../socket';
import { decks, customCards } from '../api';
import PlayerZone from './PlayerZone';
import CardSearch from './CardSearch';
import CardMaximized from './CardMaximized';
import Card from './Card';
import NoteEditor from './NoteEditor';
import DrawingCanvas from './DrawingCanvas';
import ScryModal from './ScryModal';
import ContextMenu from './ContextMenu';
import LibrarySearch from './LibrarySearch';
import ManaCost from './ManaCost';
import CounterModal from './CounterModal';
import Chat from './Chat';
import Guide from './Guide';
import ActionLog from './ActionLog';
import Cursors from './Cursors';
import DeckImport from './DeckImport';
import DeckBuilder from './DeckBuilder';
import DeckViewer from './DeckViewer';
import { useDialog } from './Dialog';
import { useEscapeKey, useIsTouchDevice, parseGameValue, fmtNum, isInfinite, INFINITE } from '../utils';

export default function GameBoard({ user, gameState, roomCode, isSpectator, onLeave, revealedCard, onDismissReveal, revealedHand, onDismissRevealedHand }) {
    const dialog = useDialog();
    const isTouch = useIsTouchDevice();
    const [showSearch, setShowSearch] = useState(null); // null, 'token', 'add'
    const [maximizedCard, setMaximizedCard] = useState(null);
    const [drawingEnabled, setDrawingEnabled] = useState(false);
    const [showScry, setShowScry] = useState(false);
    const [scryCards, setScryCards] = useState([]);
    const [scryCountModal, setScryCountModal] = useState(false);
    const [showDeckPicker, setShowDeckPicker] = useState(false);
    const [myDecks, setMyDecks] = useState([]);
    // In-game deck management modals — same components used by the lobby so
    // players don't need to leave the table to build/import/view a deck.
    const [ingameDeckImportOpen, setIngameDeckImportOpen] = useState(false);
    const [ingameDeckBuilderOpen, setIngameDeckBuilderOpen] = useState(null); // null = closed, false = new, deckId = edit
    const [ingameDeckViewerId, setIngameDeckViewerId] = useState(null);

    const refreshMyDecks = useCallback(async () => {
        const data = await decks.list();
        if (data?.decks) setMyDecks(data.decks);
    }, []);
    const [showPlayerMenu, setShowPlayerMenu] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    const [customCardModal, setCustomCardModal] = useState(false);
    const [bgModal, setBgModal] = useState(false);
    const [librarySearchOpen, setLibrarySearchOpen] = useState(false);
    const [noteEditor, setNoteEditor] = useState(null);
    const [showDicePicker, setShowDicePicker] = useState(false);
    const [rollResults, setRollResults] = useState([]);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [librarySortMode, setLibrarySortMode] = useState('order'); // 'order' | 'alphabetical'
    const [libraryViewMode, setLibraryViewMode] = useState('library'); // 'library' | 'deck'
    const [compactMode, setCompactMode] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [counterModalCard, setCounterModalCard] = useState(null); // card object whose counters are being edited
    const [roomCodeRevealed, setRoomCodeRevealed] = useState(false); // room code hidden by default; click to show
    const [roomCodeCopied, setRoomCodeCopied] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [guideOpen, setGuideOpen] = useState(false);
    const [actionLogOpen, setActionLogOpen] = useState(false);
    const [showSpectatorList, setShowSpectatorList] = useState(false);
    const [victoryAnim, setVictoryAnim] = useState(null); // { username, ts }
    // Big-batch modals — all hidden behind hovers/menus, no permanent UI footprint.
    const [settingsModalOpen, setSettingsModalOpen] = useState(false);
    const [cardFieldEditor, setCardFieldEditor] = useState(null);          // { card, field }
    const [emblemAdderTarget, setEmblemAdderTarget] = useState(null);      // playerId
    const [browseLibraryFor, setBrowseLibraryFor] = useState(null);        // { player, library }
    const [revealPickerOpen, setRevealPickerOpen] = useState(false);
    const [mulliganBottomOpen, setMulliganBottomOpen] = useState(false);
    const [stackPanelOpen, setStackPanelOpen] = useState(true); // auto-collapse?
    // Two-step "pick target" mode — used by Attach, Attack, Reveal-to, and any
    // future action where clicking an inline submenu with N options would bloat
    // the context menu. State shape: { type, sourceInstanceId, message, extra? }
    // When non-null, card clicks and player-header clicks resolve the pending
    // action instead of their normal behavior.
    const [pendingAction, setPendingAction] = useState(null);
    // Peek & exile (Gonti-style) state: while non-null, shows a modal where
    // the caster picks a card to exile from the target's top-N library.
    // Shape: { targetPlayerId, targetUsername, cards: [...], count: N }
    const [peekSession, setPeekSession] = useState(null);
    // Live cursor sharing. Only meaningful for non-touch + non-compact desktop
    // users because compact mode and mobile have layouts that don't line up
    // with the default desktop grid. Persisted so the user's preference
    // survives reloads.
    const [cursorShareEnabled, setCursorShareEnabled] = useState(() => {
        try {
            const stored = localStorage.getItem('mtg_cursorShare');
            if (stored !== null) return stored !== '0';
        } catch (_) {}
        // Default: on for players, off for spectators
        return !isSpectator;
    });
    const gameBoardRef = useRef(null);
    // Shared ref between GameBoard and DrawingCanvas so the cursor broadcaster
    // can tag its emits with the user's current pen color. DrawingCanvas
    // writes to this ref whenever its color / tool / enabled state changes;
    // GameBoard reads from it inside the throttled mousemove handler without
    // triggering rerenders.
    const penStateRef = useRef({ enabled: false, color: '#ff0000', tool: 'pen' });
    // Last cursor position (0..1 normalized). Used to re-emit a cursorMove
    // immediately when the pen color changes, so viewers see the new color
    // without having to wait for the next mouse movement.
    const lastCursorPosRef = useRef(null);
    // Eligibility is derived from runtime state — changes when compactMode
    // toggles or when the input device flips (rare). The isTouch check is
    // from useIsTouchDevice() already declared below.

    // Find the freshest version of the maximized card from current gameState
    // (so notes/counters reflect immediately without needing a useEffect race)
    const liveMaximizedCard = (() => {
        if (!maximizedCard?.instanceId || !gameState) return maximizedCard;
        for (const player of gameState.players) {
            for (const zone of Object.values(player.zones || {})) {
                if (Array.isArray(zone)) {
                    const found = zone.find(c => c?.instanceId === maximizedCard.instanceId);
                    if (found) return found;
                }
            }
        }
        return maximizedCard;
    })();

    // Listen for dice/coin roll broadcasts
    useEffect(() => {
        const handler = (event) => {
            setRollResults(prev => [...prev, event].slice(-5));
            setTimeout(() => {
                setRollResults(prev => prev.filter(r => r.id !== event.id));
            }, 6000);
        };
        socket.on('rollResult', handler);
        return () => socket.off('rollResult', handler);
    }, []);

    // Listen for notification broadcasts (turn changes, mulligans, game start, etc.)
    useEffect(() => {
        const handler = (note) => {
            const id = (Date.now().toString(36) + Math.random().toString(36).slice(2));
            setNotifications(prev => [...prev, { ...note, id }]);
            setTimeout(() => {
                setNotifications(prev => prev.filter(n => n.id !== id));
            }, 3500);
        };
        socket.on('notification', handler);
        return () => socket.off('notification', handler);
    }, []);

    // Victory event — show a fullscreen animation overlay for ~6s.
    useEffect(() => {
        const handler = (payload) => {
            setVictoryAnim(payload);
            setTimeout(() => setVictoryAnim(null), 6500);
        };
        socket.on('victory', handler);
        return () => socket.off('victory', handler);
    }, []);

    // Non-touch + non-compact desktop users see AND broadcast cursors. Mobile
    // layouts don't line up with desktop, and compact mode rearranges opponent
    // zones into a thin strip — either case would put shared cursors at
    // misleading positions, so they're excluded on both ends.
    const cursorsEligible = !isTouch && !compactMode && cursorShareEnabled;

    // Persist the cursor-share preference so reloads keep it.
    useEffect(() => {
        try { localStorage.setItem('mtg_cursorShare', cursorShareEnabled ? '1' : '0'); } catch (_) {}
    }, [cursorShareEnabled]);

    // Throttled mousemove broadcaster. Emits at most once per MOVE_THROTTLE ms
    // to avoid flooding the socket. Coordinates are 0..1 normalized to the
    // game-board DOM rect and carried alongside the sender's aspect ratio so
    // receivers can letterbox identically to drawings.
    useEffect(() => {
        if (!cursorsEligible) return;
        const el = gameBoardRef.current;
        if (!el) return;
        const MOVE_THROTTLE = 50; // ms → ~20 fps
        let lastSent = 0;
        let pendingTimer = null;
        let lastEvent = null;

        const emit = (e) => {
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;
            if (x < 0 || x > 1 || y < 0 || y > 1) return;
            // When actively drawing with the pen, tag the cursor with the
            // current brush color so other players see who's drawing what.
            // Eraser uses default hash color (no tint needed).
            // When actively drawing with the pen, use the brush color. Otherwise
            // send the user's avatar color so spectators (who aren't in the
            // players array) still get their cursor colored correctly.
            const pen = penStateRef.current;
            const color = pen.enabled && pen.tool === 'pen' ? pen.color : (me?.avatarColor || undefined);
            lastCursorPosRef.current = { x, y, aspectRatio: rect.width / rect.height };
            socket.emit('cursorMove', { x, y, aspectRatio: rect.width / rect.height, color });
        };

        const onMove = (e) => {
            const now = Date.now();
            const since = now - lastSent;
            if (since >= MOVE_THROTTLE) {
                lastSent = now;
                emit(e);
                return;
            }
            // Schedule a trailing emit so the last position before the cursor
            // stops moving still lands on receivers — otherwise a fast flick
            // followed by stillness leaves the remote cursor mid-flick.
            lastEvent = e;
            if (!pendingTimer) {
                pendingTimer = setTimeout(() => {
                    pendingTimer = null;
                    if (lastEvent) {
                        lastSent = Date.now();
                        emit(lastEvent);
                        lastEvent = null;
                    }
                }, MOVE_THROTTLE - since);
            }
        };

        el.addEventListener('mousemove', onMove);
        return () => {
            el.removeEventListener('mousemove', onMove);
            if (pendingTimer) clearTimeout(pendingTimer);
        };
    }, [cursorsEligible]);

    const toggleSelect = useCallback((id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);
    const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

    // ESC closes whichever modal is on top, or clears selection
    useEffect(() => {
        const handler = (e) => {
            if (e.key !== 'Escape') return;
            if (revealedCard) { onDismissReveal(); return; }
            if (showSearch) { setShowSearch(null); return; }
            if (maximizedCard) { setMaximizedCard(null); return; }
            if (scryCountModal) { setScryCountModal(false); return; }
            if (showScry) { setShowScry(false); return; }
            if (showDeckPicker) { setShowDeckPicker(false); return; }
            if (showPlayerMenu) { setShowPlayerMenu(null); return; }
            if (customCardModal) { setCustomCardModal(false); return; }
            if (bgModal) { setBgModal(false); return; }
            if (librarySearchOpen) { setLibrarySearchOpen(false); return; }
            if (selectedIds.size > 0) { clearSelection(); return; }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [revealedCard, showSearch, maximizedCard, showScry, scryCountModal, showDeckPicker, showPlayerMenu, customCardModal, bgModal, librarySearchOpen, selectedIds, onDismissReveal, clearSelection]);

    // Space bar toggles tap on all selected cards. Only active when something
    // is selected so it doesn't swallow spaces in inputs. We sniff the active
    // element so typing in a textarea / input never gets intercepted.
    useEffect(() => {
        if (selectedIds.size === 0) return;
        const handler = (e) => {
            if (e.key !== ' ') return;
            const tag = (document.activeElement?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;
            e.preventDefault();
            // Flip all: if any selected card is untapped, tap everything;
            // otherwise untap everything. Matches the behavior of the Tap
            // button in the selection bar.
            const ids = Array.from(selectedIds);
            const anyUntapped = ids.some(id => {
                const found = findCardWithZone(id);
                return found && !found.card.tapped;
            });
            socket.emit('bulkTap', { instanceIds: ids, tapped: anyUntapped });
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    // findCardWithZone reads gameState — include it via ref semantics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedIds, gameState]);

    const bulkTap = (tapped) => {
        socket.emit('bulkTap', { instanceIds: Array.from(selectedIds), tapped });
    };
    const bulkMove = (toZone) => {
        socket.emit('bulkMove', { instanceIds: Array.from(selectedIds), toZone, targetPlayerId: user.id });
        clearSelection();
    };

    // Find the live card object + zone name for an instanceId. Used for the
    // mobile sticky toolbar and to give CardMaximized the source zone for moves.
    const findCardWithZone = (instanceId) => {
        if (!gameState || !instanceId) return null;
        for (const player of gameState.players) {
            for (const [zoneName, zone] of Object.entries(player.zones || {})) {
                if (Array.isArray(zone)) {
                    const found = zone.find(c => c?.instanceId === instanceId);
                    if (found) return { card: found, zone: zoneName, player };
                }
            }
        }
        return null;
    };

    const firstSelectedCard = (() => {
        if (selectedIds.size === 0) return null;
        const firstId = selectedIds.values().next().value;
        return findCardWithZone(firstId)?.card || null;
    })();
    const liveMaximizedInfo = liveMaximizedCard?.instanceId
        ? findCardWithZone(liveMaximizedCard.instanceId)
        : null;

    const me = gameState.players.find(p => p.userId === user.id);
    const isHost = gameState.hostId === user.id;
    const turnPlayer = gameState.players[gameState.turnIndex];

    const handleLoadDeck = async () => {
        const data = await decks.list();
        if (data.decks) setMyDecks(data.decks);
        setShowDeckPicker(true);
    };

    const handleSelectDeck = async (deckId) => {
        const data = await decks.get(deckId);
        if (data.deck) {
            socket.emit('loadDeck', { deckData: data.deck }, () => {});
        }
        setShowDeckPicker(false);
    };

    const handleScry = () => {
        setScryCountModal(true);
    };

    const performScry = (count) => {
        setScryCountModal(false);
        if (!count || count < 1) return;
        socket.emit('scry', { count }, (res) => {
            if (res?.cards) {
                setScryCards(res.cards);
                setShowScry(true);
            }
        });
    };

    const handleMulligan = () => {
        socket.emit('mulligan', {}, (res) => {
            if (res?.error) dialog.alert(res.error, { title: 'Mulligan' });
        });
    };

    const handleStartGame = async () => {
        const ok = await dialog.confirm('Start the game? This will shuffle all decks and have everyone draw 7.', { title: 'Start game', confirmLabel: 'Start' });
        if (!ok) return;
        socket.emit('startGame', (res) => {
            if (res?.error) dialog.alert(res.error, { title: 'Start game' });
        });
    };

    // Three distinct views:
    // 1. View Deck (topbar) → ALL zones, alphabetical, read-only overview
    // 2. Click Library label → library only, alphabetical
    // 3. Tutor button → library only, draw order (for positional picks)
    const handleViewDeck = () => {
        setLibraryViewMode('deck');
        setLibrarySortMode('alphabetical');
        setLibrarySearchOpen(true);
    };

    const handleViewLibrary = () => {
        setLibraryViewMode('library');
        setLibrarySortMode('alphabetical');
        setLibrarySearchOpen(true);
    };

    const handleTutor = () => {
        setLibraryViewMode('library');
        setLibrarySortMode('order');
        setLibrarySearchOpen(true);
    };

    const handleNextTurn = () => {
        socket.emit('nextTurn');
    };

    const handleUntapAll = () => {
        socket.emit('untapAll');
    };

    const handleUndo = () => {
        socket.emit('undo');
    };

    // All toggleable designations — adding new ones here is the only place needed
    const TOGGLE_DESIGNATIONS = [
        { key: 'monarch', label: 'Monarch' },
        { key: 'initiative', label: 'Initiative' },
        { key: 'citysBlessing', label: "City's Blessing" },
    ];
    // Cycle-style designations
    const CYCLE_DESIGNATIONS = [
        { key: 'dayNight', label: 'Day/Night', states: [null, 'day', 'night'] },
    ];

    const handlePlayerContextMenu = (e, player) => {
        e.preventDefault();
        const d = player.designations || {};

        const designationItems = TOGGLE_DESIGNATIONS.map(({ key, label }) => ({
            label: d[key] ? `Remove ${label}` : `Give ${label}`,
            onClick: () => handleDesignation(player.userId, key, !d[key]),
        }));

        const cycleItems = CYCLE_DESIGNATIONS.map(({ key, label, states }) => {
            const cur = d[key];
            const idx = states.indexOf(cur);
            const next = states[(idx + 1) % states.length];
            const nextLabel = next === null ? 'Clear' : next.charAt(0).toUpperCase() + next.slice(1);
            return {
                label: `${label}: ${cur || 'none'} → ${nextLabel}`,
                onClick: () => handleDesignation(player.userId, key, next),
            };
        });

        const isSelfMenu = player.userId === user.id;

        // Items only meaningful for your own menu: auto-untap toggle and
        // reveal-hand actions. Others see commander damage / kick / infect etc.
        const selfOnlyItems = isSelfMenu ? [
            { divider: true },
            {
                label: `Auto-untap on turn start: ${player.autoUntap !== false ? 'ON' : 'OFF'}`,
                onClick: () => socket.emit('setAutoUntap', { value: !(player.autoUntap !== false) }),
            },
            {
                label: `Hand-size enforce: ${player.handSizeEnforce ? 'ON' : 'OFF'}`,
                onClick: () => socket.emit('setHandSizeEnforce', { value: !player.handSizeEnforce }),
            },
            { divider: true },
            {
                label: 'Reveal entire hand to all',
                onClick: () => socket.emit('revealHand', { targetPlayerIds: 'all' }, () => {}),
            },
            {
                label: 'Reveal entire hand to...',
                onClick: () => setPendingAction({
                    type: 'revealHandTo',
                    message: 'Click a player to reveal your hand to',
                }),
            },
            {
                label: 'Reveal specific cards from hand...',
                onClick: () => setRevealPickerOpen(true),
            },
            { divider: true },
            { label: 'Proliferate', onClick: handleProliferate },
            { label: 'Queue an extra turn', onClick: handleQueueExtraTurn },
            { label: 'Add emblem...', onClick: () => setEmblemAdderTarget(user.id) },
            { divider: true },
            { label: 'Concede', danger: true, onClick: handleConcede },
        ] : [];

        // Items shown only for OPPONENTS: browse-library (Bribery), add-emblem
        // (effects that put emblems on opponents), and the existing peek-and-exile.
        const opponentOnlyItems = !isSelfMenu ? [
            { divider: true },
            { label: 'Browse full library...', onClick: () => handleBrowseLibrary(player) },
            { label: 'Add emblem to them...', onClick: () => setEmblemAdderTarget(player.userId) },
            { label: 'Queue extra turn for them', onClick: () => socket.emit('queueExtraTurn', { targetPlayerId: player.userId }) },
        ] : [];

        const items = [
            { label: 'Add Counter', onClick: () => handleAddCounter(player.userId) },
            { divider: true },
            ...designationItems,
            ...cycleItems,
            { divider: true },
            ...gameState.players.filter(p => p.userId !== player.userId).map(p => ({
                label: `Cmdr Dmg from ${p.username}`,
                onClick: () => handleCommanderDamage(p.userId, player.userId),
            })),
            { divider: true },
            {
                label: `Infect (${player.infect || 0}/10)`,
                onClick: () => handleInfect(player.userId),
            },
            ...(player.userId !== user.id ? [
                { divider: true },
                {
                    label: 'Peek & exile (Gonti)',
                    onClick: () => handlePeekAndExile(player),
                },
            ] : []),
            ...opponentOnlyItems,
            { divider: true },
            {
                label: `Commander Died (${player.commanderDeaths || 0})`,
                onClick: () => socket.emit('incrementCommanderDeaths', { targetPlayerId: player.userId }),
            },
            ...(player.commanderDeaths > 0 ? [{
                label: 'Reset Commander Deaths',
                onClick: () => socket.emit('setCommanderDeaths', { targetPlayerId: player.userId, value: 0 }),
            }] : []),
            ...selfOnlyItems,
            ...(isHost && player.userId !== user.id ? [
                { divider: true },
                {
                    label: `Kick ${player.username}`,
                    danger: true,
                    onClick: async () => {
                        const ok = await dialog.confirm(`Kick ${player.username} from the room?`, { title: 'Kick player', danger: true, confirmLabel: 'Kick' });
                        if (ok) socket.emit('kickPlayer', { targetPlayerId: player.userId });
                    },
                },
            ] : []),
        ];
        setShowPlayerMenu({ x: e.clientX, y: e.clientY, items });
    };

    const handleDesignation = (playerId, designation, value) => {
        socket.emit('setDesignation', { targetPlayerId: playerId, designation, value });
        setShowPlayerMenu(null);
    };

    const handleCommanderDamage = async (fromId, toId) => {
        const target = gameState.players.find(p => p.userId === toId);
        const fromPlayer = gameState.players.find(p => p.userId === fromId);
        const current = target?.commanderDamageFrom?.[fromId] || 0;
        const input = await dialog.prompt(
            `Commander damage from ${fromPlayer?.username || '?'} to ${target?.username || '?'}\nCurrent: ${fmtNum(current)}/21\nEnter amount to add (negative to remove, "∞" for infinite). Affects life total.`,
            '1',
            { title: 'Commander damage' }
        );
        if (input === null) return;
        // Accept "∞"/"inf" or a plain delta.
        const s = String(input).trim().toLowerCase();
        let newDamage;
        if (s === '∞' || s === 'inf' || s === 'infinity') {
            newDamage = INFINITE;
        } else {
            const delta = parseInt(s);
            if (isNaN(delta)) return;
            newDamage = isInfinite(current) ? INFINITE : Math.max(0, current + delta);
        }
        socket.emit('setCommanderDamage', { fromPlayerId: fromId, toPlayerId: toId, damage: newDamage });
    };

    const handleInfect = async (toId) => {
        const target = gameState.players.find(p => p.userId === toId);
        const current = target?.infect || 0;
        const input = await dialog.prompt(
            `Poison counters on ${target?.username || '?'}\nCurrent: ${fmtNum(current)}/10\nEnter amount to add (negative to remove, "∞" for infinite). 10 = death.`,
            '1',
            { title: 'Infect / poison' }
        );
        if (input === null) return;
        const s = String(input).trim().toLowerCase();
        let newAmount;
        if (s === '∞' || s === 'inf' || s === 'infinity') {
            newAmount = INFINITE;
        } else {
            const delta = parseInt(s);
            if (isNaN(delta)) return;
            newAmount = isInfinite(current) ? INFINITE : Math.max(0, current + delta);
        }
        socket.emit('setInfect', { toPlayerId: toId, amount: newAmount });
    };

    // Gonti-style: look at top N of a target player's library, let the
    // caster pick one to exile face-down under their control, and send the
    // rest to the bottom in random order.
    const handlePeekAndExile = async (targetPlayer) => {
        const countStr = await dialog.prompt(
            `Look at the top N cards of ${targetPlayer.username}'s library. You'll pick one to exile face-down — the rest go to the bottom in a random order.`,
            '4',
            { title: 'Peek & exile' },
        );
        if (countStr === null) return;
        const count = parseInt(countStr, 10);
        if (isNaN(count) || count < 1) return;
        socket.emit('peekLibraryTop', { targetPlayerId: targetPlayer.userId, count }, (res) => {
            if (res?.error) { dialog.alert(res.error, { title: 'Peek' }); return; }
            setPeekSession({
                targetPlayerId: targetPlayer.userId,
                targetUsername: targetPlayer.username,
                cards: res.cards || [],
                count: (res.cards || []).length,
            });
        });
    };

    const resolvePeek = (exileInstanceId) => {
        if (!peekSession) return;
        // Randomize the return order for the non-exiled cards; this is
        // Gonti's "then put the rest on the bottom of that library in a
        // random order" behavior.
        const remaining = peekSession.cards
            .filter(c => c.instanceId !== exileInstanceId)
            .map(c => c.instanceId);
        for (let i = remaining.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        }
        socket.emit('peekResolve', {
            targetPlayerId: peekSession.targetPlayerId,
            peekCount: peekSession.count,
            exileInstanceId,
            returnOrder: remaining,
        }, (res) => {
            if (res?.error) dialog.alert(res.error, { title: 'Peek resolve' });
            setPeekSession(null);
        });
    };

    const handleAddCounter = async (playerId) => {
        const name = await dialog.prompt('Counter name (e.g. poison, energy):', '', { title: 'Add counter' });
        if (!name) return;
        const target = gameState.players.find(p => p.userId === playerId);
        const current = target?.counters?.[name] || 0;
        const valStr = await dialog.prompt(`Value for ${name}?`, fmtNum(current + 1), { title: 'Counter value' });
        if (valStr === null) return;
        const val = parseGameValue(valStr);
        if (!isNaN(val)) socket.emit('setPlayerCounter', { targetPlayerId: playerId, counter: name, value: val });
    };

    const gameStarted = !!gameState.started;
    const inMulliganPhase = !!gameState.mulliganPhase;
    const myMulliganCount = me?.mulliganCount || 0;
    const myRoll = me?.firstPlayerRoll ?? null;
    const hasRolled = myRoll !== null && myRoll !== undefined;
    const rollCount = (gameState.players || []).filter(p => typeof p.firstPlayerRoll === 'number').length;
    const totalPlayers = (gameState.players || []).length;
    // Mulligan sequence: initial draw 7 → mulligan 1 draws 7 → 2 draws 6 →
    // 3 draws 5 → blocked. Allow up to 3 mulligans total.
    const canMulligan = !gameStarted || inMulliganPhase || myMulliganCount < 3;

    const handleRollForFirstPlayer = () => {
        socket.emit('rollForFirstPlayer', {}, (res) => {
            if (res?.error) dialog.alert(res.error, { title: 'Roll' });
        });
    };

    // ─── Pending-action resolver (two-step "pick target" pattern) ───
    // When pendingAction is set, card clicks and player clicks resolve it
    // instead of their normal behavior.
    const resolvePendingCard = useCallback((targetCard) => {
        if (!pendingAction) return;
        const { type, sourceInstanceId } = pendingAction;
        if (type === 'attach') {
            socket.emit('setCardField', {
                instanceId: sourceInstanceId,
                field: 'attachedTo',
                value: targetCard.instanceId,
            });
        }
        setPendingAction(null);
    }, [pendingAction]);

    const resolvePendingPlayer = useCallback((targetPlayer) => {
        if (!pendingAction) return;
        const { type, sourceInstanceId } = pendingAction;
        if (type === 'attack') {
            socket.emit('setCardField', {
                instanceId: sourceInstanceId,
                field: 'attackingPlayerId',
                value: targetPlayer.userId,
            });
        } else if (type === 'revealTo') {
            socket.emit('revealCard', {
                instanceId: sourceInstanceId,
                targetPlayerIds: [targetPlayer.userId],
            });
        } else if (type === 'revealHandTo') {
            socket.emit('revealHand', { targetPlayerIds: [targetPlayer.userId] });
        }
        setPendingAction(null);
    }, [pendingAction]);

    // ─── Big-batch action handlers (all wired as props into PlayerZone) ───
    const handleCloneCard = (card) => {
        socket.emit('cloneCard', { instanceId: card.instanceId }, (res) => {
            if (res?.error) dialog.alert(res.error, { title: 'Clone' });
        });
    };

    const handleForetell = (card) => {
        socket.emit('foretellCard', { instanceId: card.instanceId }, (res) => {
            if (res?.error) dialog.alert(res.error, { title: 'Foretell' });
        });
    };

    const handleCastForetold = (card) => {
        socket.emit('castForetold', { instanceId: card.instanceId }, (res) => {
            if (res?.error) dialog.alert(res.error, { title: 'Cast foretold' });
        });
    };

    const handleCastFromZone = (card, fromZone, exileAfter) => {
        socket.emit('castFromZone', { instanceId: card.instanceId, fromZone, exileAfter }, (res) => {
            if (res?.error) dialog.alert(res.error, { title: 'Cast' });
        });
    };

    const handleTakeControl = (card, untilEndOfTurn) => {
        socket.emit('takeControl', { instanceId: card.instanceId, untilEndOfTurn }, (res) => {
            if (res?.error) dialog.alert(res.error, { title: 'Take control' });
        });
    };

    const handleShowCardFieldEditor = (card, field) => {
        setCardFieldEditor({ card, field });
    };

    const [proliferateModalOpen, setProliferateModalOpen] = useState(false);
    const handleProliferate = () => {
        setProliferateModalOpen(true);
    };

    const handleConcede = async () => {
        const ok = await dialog.confirm('Concede the game?', { title: 'Concede', danger: true, confirmLabel: 'Concede' });
        if (!ok) return;
        socket.emit('concede', () => {});
    };

    const handleQueueExtraTurn = () => {
        socket.emit('queueExtraTurn', { targetPlayerId: user.id }, (res) => {
            if (res?.error) dialog.alert(res.error, { title: 'Extra turn' });
        });
    };

    const handleBrowseLibrary = (player) => {
        socket.emit('browseLibraryFull', { targetPlayerId: player.userId }, (res) => {
            if (res?.error) { dialog.alert(res.error, { title: 'Browse library' }); return; }
            setBrowseLibraryFor({ player, library: res.library || [] });
        });
    };

    // London-mulligan: when the server flags pending bottoming, prompt the
    // user to pick the cards. Triggered by an effect on `me.mulliganBottomPending`.
    useEffect(() => {
        if (me?.mulliganBottomPending > 0 && !mulliganBottomOpen) {
            setMulliganBottomOpen(true);
        }
        if (!me?.mulliganBottomPending && mulliganBottomOpen) {
            setMulliganBottomOpen(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [me?.mulliganBottomPending]);

    // Avatar color persistence. The server's default avatar color is a
    // deterministic hash of userId, so a new room's playerState always starts
    // with that hash even if you previously picked a different color in another
    // room. Persist the user's choice in localStorage (keyed by userId so
    // accounts don't share) and re-emit it whenever we land in a room with a
    // different value. This makes the picked color sticky across rooms / page
    // reloads / logout-login.
    useEffect(() => {
        if (!me?.userId) return;
        let preferred;
        try { preferred = localStorage.getItem(`mtg_avatarColor_${me.userId}`); } catch (_) { /* private mode */ }
        if (!preferred || !/^#[0-9a-fA-F]{6}$/.test(preferred)) return;
        if (me.avatarColor === preferred) return;
        socket.emit('setAvatarColor', { color: preferred });
    }, [me?.userId, me?.avatarColor]);

    return (
        <div ref={gameBoardRef} className={`game-board ${compactMode ? 'compact-mode' : ''}`}>
            {/* Top bar */}
            <div className="game-topbar">
                <div className="topbar-left">
                    <button
                        type="button"
                        className={`room-code ${roomCodeRevealed ? 'revealed' : 'hidden'}`}
                        title={roomCodeRevealed ? 'Click to copy invite link' : 'Click to reveal room code'}
                        onClick={async () => {
                            const code = roomCode || gameState.roomCode;
                            if (!roomCodeRevealed) {
                                setRoomCodeRevealed(true);
                                return;
                            }
                            // Already revealed — a second click copies the invite link.
                            try {
                                const url = `${window.location.origin}/invite/${code}`;
                                await navigator.clipboard?.writeText(url);
                                setRoomCodeCopied(true);
                                setTimeout(() => setRoomCodeCopied(false), 1500);
                            } catch (err) {
                                console.warn('[room-code] copy failed:', err);
                            }
                        }}
                    >
                        Room: {roomCodeRevealed ? (roomCode || gameState.roomCode) : '••••••'}
                        {roomCodeCopied && <span className="room-code-copied"> copied</span>}
                    </button>
                    {inMulliganPhase ? (
                        <>
                            <span className="turn-info mulligan-phase-info">
                                Mulligan phase — <strong>{rollCount}/{totalPlayers}</strong> rolled
                            </span>
                            {!isSpectator && !hasRolled && (
                                <button
                                    onClick={handleRollForFirstPlayer}
                                    className="small-btn primary-btn"
                                    title="Click when your mulligans are done. Rolls a d20 for first-player order."
                                >
                                    Ready & Roll d20
                                </button>
                            )}
                            {!isSpectator && hasRolled && (
                                <span className="mulligan-my-roll" title="Your d20 result">
                                    You rolled <strong>{myRoll}</strong>
                                </span>
                            )}
                        </>
                    ) : (
                        <>
                            <span className="turn-info">
                                Turn: <strong>{turnPlayer?.username || '?'}</strong>
                            </span>
                            {gameStarted && !isSpectator && (
                                <button onClick={handleNextTurn} className="small-btn turn-end-btn">End Turn</button>
                            )}
                        </>
                    )}
                    {/* Extra-turn indicator — shows who's queued for an extra turn next */}
                    {Array.isArray(gameState.extraTurns) && gameState.extraTurns.length > 0 && (
                        <span className="extra-turn-indicator" title="Extra turns queued">
                            ↺ {gameState.extraTurns.length}: {gameState.extraTurns.map(t => t.ownerName).join(', ')}
                            {!isSpectator && <button className="small-btn" style={{ marginLeft: 4 }} onClick={() => socket.emit('removeExtraTurn', { index: 0 })}>x</button>}
                        </span>
                    )}
                    {/* Stack indicator — auto-shown when non-empty */}
                    {Array.isArray(gameState.stack) && gameState.stack.length > 0 && (
                        <span className="stack-indicator" title="The stack — top spell resolves first">
                            Stack: {gameState.stack.length}
                            <button className="small-btn" style={{ marginLeft: 4 }} onClick={() => setStackPanelOpen(o => !o)}>{stackPanelOpen ? 'Hide' : 'Show'}</button>
                        </span>
                    )}
                    {isSpectator && (
                        <>
                            <span className="spectator-badge">Spectating</span>
                            {/* Perspective mode — only spectators see this. Picking
                                a player switches the spectator's view to that player's
                                perspective (their hand visible, others hidden). Useful
                                for coaching streams. Default: see all hands. */}
                            <select
                                className="spec-perspective-select"
                                value={gameState.viewerPerspectiveOf || ''}
                                onChange={e => socket.emit('setSpectatorPerspective', { targetPlayerId: e.target.value || null })}
                                title="View as a specific player (their hand only)"
                            >
                                <option value="">View: all hands</option>
                                {gameState.players.map(p => (
                                    <option key={p.userId} value={p.userId}>View as: {p.username}</option>
                                ))}
                            </select>
                        </>
                    )}
                    {gameState.spectators && gameState.spectators.length > 0 && (
                        <span className="spectator-count-wrapper">
                            <button
                                className="spectator-count"
                                type="button"
                                onClick={() => setShowSpectatorList(v => !v)}
                                title="Click to see who's watching"
                            >
                                👁 {gameState.spectators.length} watching
                            </button>
                            {showSpectatorList && (
                                <div className="spectator-list-popover" onMouseLeave={() => setShowSpectatorList(false)}>
                                    <div className="spectator-list-head">Spectators</div>
                                    {gameState.spectators.map(s => (
                                        <div key={s.userId} className={`spectator-list-row ${s.connected ? 'online' : 'offline'}`}>
                                            <span className={`dot ${s.connected ? 'online' : 'offline'}`} />
                                            {s.username}
                                            {isHost && (
                                                <button className="spectator-kick-btn" title={`Kick ${s.username}`} onClick={(e) => { e.stopPropagation(); socket.emit('kickSpectator', { targetUserId: s.userId }); }}>x</button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </span>
                    )}
                </div>
                <div className="topbar-right">
                    {/* Spectators don't get any game-action buttons — they can
                        only view, chat, and open the guide. All mutating events
                        are also rejected server-side as a backstop. */}
                    {!isSpectator && !gameStarted && isHost && (
                        <button onClick={handleStartGame} className="primary-btn small-btn">Start Game</button>
                    )}
                    {!isSpectator && !gameStarted && (
                        <button onClick={handleLoadDeck} className="small-btn">Load Deck</button>
                    )}
                    {!isSpectator && gameStarted && (
                        <div className="topbar-group">
                            <button onClick={handleUntapAll} className="small-btn" title="Untap all your tapped permanents">Untap All</button>
                            <button onClick={handleUndo} className="small-btn" title="Undo last action">Undo</button>
                            <button onClick={handleMulligan} className="small-btn" disabled={!canMulligan} title={canMulligan ? `Mulligan (draws ${Math.max(5, 8 - (myMulliganCount + 1))} next)` : 'No more mulligans'}>Mulligan</button>
                        </div>
                    )}
                    {!isSpectator && gameStarted && (
                        <div className="topbar-group">
                            <button onClick={handleViewDeck} className="small-btn" title="View your full decklist">Deck</button>
                            <button onClick={() => setShowSearch('token')} className="small-btn" title="Search for tokens">Tokens</button>
                            <button onClick={() => setShowSearch('add')} className="small-btn" title="Search for any card">Search</button>
                            <button onClick={() => setShowDicePicker(true)} className="small-btn" title="Roll dice or flip coins">Roll</button>
                            <button onClick={() => setCustomCardModal(true)} className="small-btn" title="Create or play a custom card">Custom</button>
                        </div>
                    )}
                    <div className="topbar-group topbar-utils">
                        <button onClick={() => setSettingsModalOpen(true)} className="topbar-icon-btn" title="Game settings">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                            </svg>
                        </button>
                        <button onClick={() => setGuideOpen(true)} className="topbar-icon-btn" title="How to play">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                            </svg>
                        </button>
                        <button onClick={() => setActionLogOpen(o => !o)} className="topbar-icon-btn" title="Action log">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 6h18M3 12h18M3 18h12"/>
                            </svg>
                        </button>
                        {!isSpectator && (
                            <button onClick={() => setBgModal(true)} className="topbar-icon-btn" title="Set background image">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                                </svg>
                            </button>
                        )}
                    </div>
                    <div className="topbar-group topbar-toggles">
                        {!isTouch && (
                            <label className="compact-toggle small-btn" title="Share cursor with other desktop players">
                                <input type="checkbox" checked={cursorShareEnabled} onChange={e => setCursorShareEnabled(e.target.checked)} />
                                Cursor
                            </label>
                        )}
                        <label className="compact-toggle small-btn" title="Toggle compact layout">
                            <input type="checkbox" checked={compactMode} onChange={e => setCompactMode(e.target.checked)} />
                            Compact
                        </label>
                        <button onClick={onLeave} className="small-btn danger" title="Leave the room">Leave</button>
                    </div>
                </div>
            </div>

            {/* Pending-action banner — shows when the user is in "pick target" mode */}
            {pendingAction && (
                <div className="pending-action-banner">
                    <span>{pendingAction.message || 'Click a target...'}</span>
                    <button className="small-btn" onClick={() => setPendingAction(null)}>Cancel</button>
                </div>
            )}

            {/* Player zones */}
            <div className={`player-zones players-${gameState.players.length}`}>
                {(() => {
                    const renderPlayer = (player, idx) => {
                        const isSelf = player.userId === user.id;
                        return (
                            <div key={player.userId} className={`player-zone-wrapper ${isSelf ? 'is-self' : 'is-other'}`}>
                                <PlayerZone
                                    player={player}
                                    isOwner={isSelf}
                                    userId={user.id}
                                    allPlayers={gameState.players}
                                    onMaximizeCard={setMaximizedCard}
                                    onScry={isSelf ? handleScry : undefined}
                                    onTutor={isSelf ? handleTutor : undefined}
                                    onViewLibrary={isSelf ? handleViewLibrary : undefined}
                                    onPlayerContextMenu={(e) => handlePlayerContextMenu(e, player)}
                                    selectedIds={selectedIds}
                                    onToggleSelect={toggleSelect}
                                    onClearSelection={clearSelection}
                                    compact={compactMode && !isSelf}
                                    isCurrentTurn={idx === gameState.turnIndex}
                                    touchMode={isTouch}
                                    spectating={isSpectator}
                                    gameStarted={gameStarted}
                                    onCloneCard={handleCloneCard}
                                    onShowCardFieldEditor={handleShowCardFieldEditor}
                                    onTakeControl={handleTakeControl}
                                    onCastFromZone={handleCastFromZone}
                                    onForetellCard={handleForetell}
                                    onCastForetold={handleCastForetold}
                                    pendingAction={pendingAction}
                                    onStartPendingAction={setPendingAction}
                                    onResolvePendingCard={resolvePendingCard}
                                    onResolvePendingPlayer={resolvePendingPlayer}
                                />
                            </div>
                        );
                    };

                    if (compactMode) {
                        // Compact mode: my section dominates the top, opponents in a thin strip below
                        const self = gameState.players.find(p => p.userId === user.id);
                        const others = gameState.players.filter(p => p.userId !== user.id);
                        return (
                            <>
                                {self && renderPlayer(self, gameState.players.indexOf(self))}
                                {others.length > 0 && (
                                    <div className="others-row">
                                        {others.map(p => renderPlayer(p, gameState.players.indexOf(p)))}
                                    </div>
                                )}
                            </>
                        );
                    }
                    return gameState.players.map((p, i) => renderPlayer(p, i));
                })()}
            </div>

            {/* Selection action bar — hidden for spectators, since all the
                actions it exposes mutate shared state and the server would
                reject them anyway. */}
            {!isSpectator && selectedIds.size > 0 && (
                <div className={`selection-bar ${isTouch ? 'touch-toolbar' : ''}`}>
                    <span className="selection-count">
                        {selectedIds.size === 1 && firstSelectedCard
                            ? firstSelectedCard.name || '1 selected'
                            : `${selectedIds.size} selected`}
                    </span>
                    {/* Single-card-only actions */}
                    {selectedIds.size === 1 && firstSelectedCard && (
                        <>
                            <button onClick={() => setMaximizedCard(firstSelectedCard)}>View</button>
                            <button onClick={() => socket.emit(
                                firstSelectedCard.backImageUri ? 'flipCard' : 'toggleFaceDown',
                                { instanceId: firstSelectedCard.instanceId },
                            )}>Flip</button>
                            <button onClick={() => socket.emit('revealCard', { instanceId: firstSelectedCard.instanceId, targetPlayerIds: 'all' })}>Reveal</button>
                        </>
                    )}
                    {/* Counter + Note work for any number of selected cards.
                        For multi-select, the counter/note is applied to every
                        selected card. */}
                    <button onClick={() => {
                        if (firstSelectedCard) setCounterModalCard(firstSelectedCard);
                    }}>+Counter</button>
                    <button onClick={() => {
                        if (firstSelectedCard) setNoteEditor({ instanceId: firstSelectedCard.instanceId, bulkIds: selectedIds.size > 1 ? Array.from(selectedIds) : null });
                    }}>Note</button>
                    <button onClick={() => bulkTap()}>Tap</button>
                    <button onClick={() => bulkMove('battlefield')}>→ BF</button>
                    <button onClick={() => bulkMove('hand')}>→ Hand</button>
                    <button onClick={() => bulkMove('graveyard')}>→ GY</button>
                    <button onClick={() => bulkMove('exile')}>→ Exile</button>
                    <button onClick={() => bulkMove('library')}>→ Lib</button>
                    <button onClick={() => bulkMove('commandZone')}>→ Cmd</button>
                    <button onClick={clearSelection}>Clear</button>
                </div>
            )}

            {/* Drawing overlay — spectators see everyone's strokes but can't
                draw. Pass a no-op toggle + forced-off enabled so the canvas is
                purely read-only and the toggle button is hidden by CSS below. */}
            <DrawingCanvas
                drawings={gameState.drawings}
                enabled={!isSpectator && drawingEnabled}
                onToggle={isSpectator ? () => {} : (() => setDrawingEnabled(!drawingEnabled))}
                hideToggle={isSpectator}
                penStateRef={penStateRef}
                onPenColorChange={(newColor) => {
                    // Push a one-off cursorMove with the new color so other
                    // players see the cursor recolor immediately instead of
                    // waiting for the next mouse movement.
                    if (!cursorsEligible) return;
                    const pen = penStateRef.current;
                    if (!pen.enabled || pen.tool !== 'pen') return;
                    const last = lastCursorPosRef.current;
                    if (!last) return;
                    socket.emit('cursorMove', {
                        x: last.x,
                        y: last.y,
                        aspectRatio: last.aspectRatio,
                        color: newColor,
                    });
                }}
            />

            {/* Chat — always rendered, collapsible */}
            <Chat
                messages={gameState.chat || []}
                currentUserId={user.id}
                open={chatOpen}
                onToggle={() => setChatOpen(o => !o)}
                players={gameState.players}
            />

            {/* Action log — slide-in side panel, visible to players and spectators */}
            <ActionLog
                history={gameState.actionHistory || []}
                players={gameState.players}
                open={actionLogOpen}
                onToggle={() => setActionLogOpen(o => !o)}
            />

            {/* Live cursor overlay — only rendered for eligible (non-touch +
                non-compact) viewers. Incoming events are still received by
                everyone but the component won't mount outside eligibility. */}
            {cursorsEligible && (
                <Cursors containerRef={gameBoardRef} currentUserId={user.id} players={gameState.players} />
            )}

            {/* Guide / How-to-play */}
            {guideOpen && <Guide onClose={() => setGuideOpen(false)} />}

            {/* Revealed hand viewer — fired by handRevealed socket event.
                Cards open CardMaximized on click; that modal is a body-level
                portal so it naturally renders above this one. */}
            {revealedHand && (
                <div className="modal-overlay reveal-top" onClick={(e) => { if (e.target === e.currentTarget) onDismissRevealedHand(); }}>
                    <div className="modal revealed-hand-modal">
                        <div className="modal-header">
                            <h3>{revealedHand.revealedByName || 'Someone'} revealed their hand</h3>
                            <button className="close-btn" onClick={onDismissRevealedHand}>x</button>
                        </div>
                        <div className="revealed-hand-grid">
                            {(revealedHand.cards || []).length === 0 && <div className="muted">Empty hand.</div>}
                            {(revealedHand.cards || []).map((c, i) => (
                                <div key={c.instanceId || i} className="revealed-hand-card">
                                    <Card
                                        card={c}
                                        onClick={() => setMaximizedCard(c)}
                                    />
                                    <div className="revealed-hand-name">{c.name}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Peek & exile (Gonti) resolver. Shows the top N cards of the
                target's library and asks the caster which to exile. */}
            {peekSession && (
                <div className="modal-overlay" style={{ zIndex: 1100 }}>
                    <div className="modal peek-exile-modal">
                        <div className="modal-header">
                            <h3>Looking at top {peekSession.count} of {peekSession.targetUsername}'s library</h3>
                            <button className="close-btn" onClick={() => setPeekSession(null)}>x</button>
                        </div>
                        <p className="muted">Pick one card to exile face-down under your control. The rest go to the bottom in random order.</p>
                        <div className="revealed-hand-grid">
                            {peekSession.cards.map((c) => (
                                <div key={c.instanceId} className="revealed-hand-card">
                                    <Card card={c} onClick={() => setMaximizedCard(c)} />
                                    <div className="revealed-hand-name">{c.name}</div>
                                    <button
                                        className="small-btn primary-btn"
                                        onClick={() => resolvePeek(c.instanceId)}
                                    >Exile this</button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Victory animation overlay */}
            {victoryAnim && (
                <div className="victory-overlay">
                    <div className="victory-content">
                        <div className="victory-crown">👑</div>
                        <div className="victory-label">Victory</div>
                        <div className="victory-name">{victoryAnim.username}</div>
                        <div className="victory-sub">is the last player standing</div>
                    </div>
                </div>
            )}

            {/* Modals */}
            {showSearch && <CardSearch mode={showSearch} onClose={() => setShowSearch(null)} />}
            {maximizedCard && (() => {
                // Compute attachment info for the maximized card so it can
                // display "Attached to X" or "Equipped by Y" in the detail view.
                const allBf = [];
                for (const p of gameState.players) {
                    for (const c of (p.zones?.battlefield || [])) allBf.push(c);
                }
                const bfMap = {};
                for (const c of allBf) bfMap[c.instanceId] = c;
                const maxAttachedToName = liveMaximizedCard?.attachedTo && bfMap[liveMaximizedCard.attachedTo]
                    ? bfMap[liveMaximizedCard.attachedTo].name : null;
                const maxAttachments = allBf
                    .filter(c => c.attachedTo === liveMaximizedCard?.instanceId)
                    .map(c => ({ name: c.name, imageUri: c.imageUri }));
                return (
                    <CardMaximized
                        card={liveMaximizedCard}
                        onClose={() => setMaximizedCard(null)}
                        onClickCard={(c) => setMaximizedCard(c)}
                        onAddNote={isSpectator ? undefined : (instanceId) => setNoteEditor({ instanceId })}
                        onAddCounter={isSpectator ? undefined : (c) => setCounterModalCard(c)}
                        allPlayers={gameState.players}
                        userId={user.id}
                        currentZone={liveMaximizedInfo?.zone}
                        readOnly={isSpectator}
                        attachedToName={maxAttachedToName}
                        attachments={maxAttachments.length > 0 ? maxAttachments : null}
                    />
                );
            })()}
            {noteEditor && <NoteEditor instanceId={noteEditor.instanceId} onClose={() => setNoteEditor(null)} />}
            {revealedCard && (
                <div className="modal-overlay">
                    <div className="card-revealed">
                        <h3>{revealedCard.revealedBy} reveals:</h3>
                        <CardMaximized card={revealedCard} onClose={onDismissReveal} />
                    </div>
                </div>
            )}
            {showScry && <ScryModal cards={scryCards} onClose={() => setShowScry(false)} />}
            {scryCountModal && <ScryCountModal onCancel={() => setScryCountModal(false)} onSubmit={performScry} />}
            {showDeckPicker && (
                <div className="modal-overlay">
                    <div className="modal">
                        <div className="modal-header">
                            <h2>Select Deck</h2>
                            <button className="close-btn" onClick={() => setShowDeckPicker(false)}>x</button>
                        </div>
                        <div className="deck-picker-actions">
                            <button className="small-btn" onClick={() => setIngameDeckBuilderOpen(false)}>Build New</button>
                            <button className="small-btn" onClick={() => setIngameDeckImportOpen(true)}>Import</button>
                        </div>
                        {myDecks.length === 0 ? (
                            <p className="muted">No decks saved. Build or import one.</p>
                        ) : (
                            <div className="deck-list">
                                {myDecks.map(d => (
                                    <div key={d._id} className="deck-item"
                                        onClick={() => handleSelectDeck(d._id)}>
                                        <div className="deck-info">
                                            <span className="deck-name">{d.name}</span>
                                            <span className="deck-commander">
                                                {d.commanders?.map(c => c.name).join(' & ')}
                                                {d.sharedByUsername && (
                                                    <span className="deck-author-badge"> · shared by {d.sharedByUsername}</span>
                                                )}
                                            </span>
                                        </div>
                                        <button className="small-btn" title="View deck" onClick={(e) => { e.stopPropagation(); setIngameDeckViewerId(d._id); }}>View</button>
                                        <button className="small-btn" title="Edit deck" onClick={(e) => { e.stopPropagation(); setIngameDeckBuilderOpen(d._id); }}>Edit</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* In-game deck management — these three modals stack on top of
                the deck picker so you can create / edit / inspect decks without
                leaving the table. All of them use the same components the
                lobby uses; they share state via the decks REST API so changes
                are immediately reflected in myDecks on save. */}
            {ingameDeckImportOpen && (
                <DeckImport
                    onImport={async (deckData) => {
                        const data = await decks.create(deckData);
                        if (data?.deck) setMyDecks(prev => [data.deck, ...prev]);
                        setIngameDeckImportOpen(false);
                    }}
                    onDeckCreated={(deck) => {
                        if (deck) setMyDecks(prev => [deck, ...prev]);
                        setIngameDeckImportOpen(false);
                    }}
                    onClose={() => setIngameDeckImportOpen(false)}
                />
            )}
            {ingameDeckBuilderOpen !== null && (
                <DeckBuilder
                    deckId={ingameDeckBuilderOpen || null}
                    onClose={() => setIngameDeckBuilderOpen(null)}
                    onSaved={() => refreshMyDecks()}
                />
            )}
            {ingameDeckViewerId && (
                <DeckViewer
                    deckId={ingameDeckViewerId}
                    onClose={() => setIngameDeckViewerId(null)}
                    onDelete={async (id) => {
                        await decks.delete(id);
                        setMyDecks(prev => prev.filter(d => d._id !== id));
                        setIngameDeckViewerId(null);
                    }}
                    onEdit={(id) => {
                        setIngameDeckViewerId(null);
                        setIngameDeckBuilderOpen(id);
                    }}
                />
            )}

            {/* Player context menu */}
            {showPlayerMenu && (
                <ContextMenu
                    x={showPlayerMenu.x}
                    y={showPlayerMenu.y}
                    items={showPlayerMenu.items}
                    onClose={() => setShowPlayerMenu(null)}
                />
            )}

            {customCardModal && <CustomCardModal onClose={() => setCustomCardModal(false)} />}
            {bgModal && <BackgroundModal onClose={() => setBgModal(false)} />}
            {counterModalCard && (
                <CounterModal
                    card={counterModalCard}
                    onAdd={(name, val) => {
                        // Apply to all selected cards if multi-selected,
                        // otherwise just the one card.
                        const targets = selectedIds.size > 1
                            ? Array.from(selectedIds)
                            : [counterModalCard.instanceId];
                        for (const id of targets) {
                            socket.emit('setCardCounter', { instanceId: id, counter: name, value: val });
                        }
                        setCounterModalCard(null);
                    }}
                    onClose={() => setCounterModalCard(null)}
                />
            )}
            {librarySearchOpen && (
                <LibrarySearch
                    onClose={() => setLibrarySearchOpen(false)}
                    onMaximizeCard={setMaximizedCard}
                    sortMode={librarySortMode}
                    viewMode={libraryViewMode}
                    allZones={libraryViewMode === 'deck' && me ? me.zones : null}
                />
            )}
            {showDicePicker && <DiceModal onClose={() => setShowDicePicker(false)} />}

            {/* Center-screen notifications with fade */}
            {notifications.length > 0 && (
                <div className="center-notifications">
                    {notifications.map(n => (
                        <div key={n.id} className={`center-notification type-${n.type || 'info'}`}>
                            {n.message}
                        </div>
                    ))}
                </div>
            )}

            {/* Floating roll results */}
            {rollResults.length > 0 && (
                <div className="roll-results-stack">
                    {rollResults.map(r => (
                        <RollToast key={r.id} result={r} />
                    ))}
                </div>
            )}

            {/* ─── Big-batch modals ─────────────────────────────────────── */}
            {settingsModalOpen && (
                <SettingsModal
                    settings={gameState.settings}
                    isHost={isHost}
                    sharedTeamLife={!!gameState.sharedTeamLife}
                    teams={gameState.teams || []}
                    me={me}
                    onClose={() => setSettingsModalOpen(false)}
                />
            )}

            {cardFieldEditor && (
                <CardFieldEditorModal
                    card={cardFieldEditor.card}
                    field={cardFieldEditor.field}
                    onClose={() => setCardFieldEditor(null)}
                    onSubmit={(value) => {
                        socket.emit('setCardField', {
                            instanceId: cardFieldEditor.card.instanceId,
                            field: cardFieldEditor.field,
                            value,
                        });
                        setCardFieldEditor(null);
                    }}
                />
            )}

            {emblemAdderTarget && (
                <EmblemAdderModal
                    targetPlayerId={emblemAdderTarget}
                    onClose={() => setEmblemAdderTarget(null)}
                    onSubmit={({ name, oracleText }) => {
                        socket.emit('addEmblem', { targetPlayerId: emblemAdderTarget, name, oracleText });
                        setEmblemAdderTarget(null);
                    }}
                />
            )}

            {browseLibraryFor && (
                <BrowseLibraryModal
                    player={browseLibraryFor.player}
                    library={browseLibraryFor.library}
                    onClose={() => setBrowseLibraryFor(null)}
                    onMaximizeCard={setMaximizedCard}
                    onSteal={(card) => {
                        // Move the chosen card from the target's library directly
                        // to the requester's exile (Bribery → "put it onto the
                        // battlefield under your control"). The user can then
                        // drag it to battlefield manually if they prefer.
                        socket.emit('moveCard', {
                            instanceId: card.instanceId,
                            fromZone: 'library',
                            toZone: 'battlefield',
                            targetPlayerId: user.id,
                        });
                        setBrowseLibraryFor(null);
                    }}
                />
            )}

            {revealPickerOpen && me && (
                <RevealHandPickerModal
                    hand={me.zones?.hand || []}
                    targets={gameState.players.filter(p => p.userId !== user.id)}
                    onClose={() => setRevealPickerOpen(false)}
                    onSubmit={({ instanceIds, targetPlayerIds }) => {
                        socket.emit('revealSpecificFromHand', { instanceIds, targetPlayerIds });
                        setRevealPickerOpen(false);
                    }}
                />
            )}

            {mulliganBottomOpen && me && me.mulliganBottomPending > 0 && (
                <MulliganBottomModal
                    hand={me.zones?.hand || []}
                    need={me.mulliganBottomPending}
                    onSubmit={(instanceIds) => {
                        socket.emit('mulliganBottom', { instanceIds }, (res) => {
                            if (res?.error) dialog.alert(res.error, { title: 'Mulligan bottom' });
                            else setMulliganBottomOpen(false);
                        });
                    }}
                />
            )}

            {proliferateModalOpen && (
                <ProliferateModal
                    players={gameState.players}
                    onClose={() => setProliferateModalOpen(false)}
                    onSubmit={(targets) => {
                        socket.emit('proliferate', { targets }, (res) => {
                            if (res?.error) dialog.alert(res.error, { title: 'Proliferate' });
                        });
                        setProliferateModalOpen(false);
                    }}
                />
            )}

            {/* Stack panel (room-level). Renders inline when non-empty + open. */}
            {Array.isArray(gameState.stack) && gameState.stack.length > 0 && stackPanelOpen && (
                <StackPanel
                    stack={gameState.stack}
                    isSpectator={isSpectator}
                    onClose={() => setStackPanelOpen(false)}
                    onPop={(idx) => socket.emit('stackPop', { index: idx })}
                    onClear={() => socket.emit('stackClear')}
                />
            )}
        </div>
    );
}

// Animated dice-result toast. On first render it cycles through random
// numbers for ~700ms to fake a rolling die, then locks on the real value.
// For coin flips and multi-die rolls (where cycling doesn't make as much
// sense) it renders the final result immediately in the old flat style.
function RollToast({ result: r }) {
    const [rolling, setRolling] = React.useState(r.type === 'dice' && r.count === 1);
    const [displayed, setDisplayed] = React.useState(() => {
        if (r.type === 'dice' && r.count === 1) {
            return 1 + Math.floor(Math.random() * (r.sides || 20));
        }
        return r.results?.[0] ?? '';
    });
    React.useEffect(() => {
        if (!rolling) return;
        // Cycle random numbers faster than the eye, then settle. The
        // interval time increases so it feels like a die slowing down.
        let ticks = 0;
        const maxTicks = 12; // ~700ms at increasing intervals
        let current = 40;
        let stop = false;
        const tick = () => {
            if (stop) return;
            ticks++;
            if (ticks >= maxTicks) {
                setDisplayed(r.results?.[0] ?? '?');
                setRolling(false);
                return;
            }
            setDisplayed(1 + Math.floor(Math.random() * (r.sides || 20)));
            current = Math.min(120, current + 10);
            setTimeout(tick, current);
        };
        setTimeout(tick, current);
        return () => { stop = true; };
    }, [rolling, r.sides, r.results]);

    if (r.type === 'coin') {
        return (
            <div className="roll-result-toast">
                <strong>{r.playerName}</strong>{' '}
                flipped {r.count > 1 ? `${r.count} coins` : 'a coin'}: {r.results.join(', ')}
            </div>
        );
    }
    if (r.count > 1) {
        return (
            <div className="roll-result-toast">
                <strong>{r.playerName}</strong>{' '}
                rolled {r.count}d{r.sides}: {r.results.join(', ')} = {r.total}
            </div>
        );
    }
    return (
        <div className={`roll-result-toast dice-toast ${rolling ? 'rolling' : 'settled'}`}>
            <strong>{r.playerName}</strong>{' '}
            rolled a d{r.sides}
            {r.label ? <span className="dice-label"> — {r.label}</span> : null}
            <div className="dice-big">{displayed}</div>
        </div>
    );
}

function DiceModal({ onClose }) {
    useEscapeKey(onClose);
    const [count, setCount] = useState(1);
    const sides = [4, 6, 8, 10, 12, 20, 100];

    const roll = (s) => {
        socket.emit('rollDice', { sides: s, count }, () => {});
        onClose();
    };
    const flip = () => {
        socket.emit('flipCoin', { count }, () => {});
        onClose();
    };

    return (
        <div className="modal-overlay">
            <div className="modal dice-modal">
                <div className="modal-header">
                    <h2>Roll</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <div className="dice-count">
                    <label>Count:</label>
                    <input type="number" min={1} max={20} value={count} onChange={e => setCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))} />
                </div>
                <div className="dice-grid">
                    {sides.map(s => (
                        <button key={s} className="dice-btn" onClick={() => roll(s)}>d{s}</button>
                    ))}
                    <button className="dice-btn coin-btn" onClick={flip}>Coin</button>
                </div>
            </div>
        </div>
    );
}

function ScryCountModal({ onSubmit, onCancel }) {
    useEscapeKey(onCancel);
    const [count, setCount] = useState(1);
    return (
        <div className="modal-overlay">
            <div className="modal scry-count-modal">
                <div className="modal-header">
                    <h2>Scry</h2>
                    <button className="close-btn" onClick={onCancel}>x</button>
                </div>
                <label className="muted">How many cards to scry?</label>
                <input
                    type="number"
                    min={1}
                    max={50}
                    value={count}
                    onChange={e => setCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                    onKeyDown={e => e.key === 'Enter' && onSubmit(count)}
                    autoFocus
                />
                <div className="quick-counts">
                    {[1, 2, 3, 4, 5].map(n => (
                        <button key={n} onClick={() => onSubmit(n)} className="small-btn">{n}</button>
                    ))}
                </div>
                <div className="modal-actions">
                    <button onClick={onCancel}>Cancel</button>
                    <button onClick={() => onSubmit(count)} className="primary-btn">Scry</button>
                </div>
            </div>
        </div>
    );
}

function CustomCardModal({ onClose }) {
    useEscapeKey(onClose);
    const dialog = useDialog();
    const [savedCards, setSavedCards] = useState([]);
    const [editing, setEditing] = useState(null); // null = list view, otherwise card object
    const [loading, setLoading] = useState(true);

    const blankCard = () => ({ name: '', imageUrl: '', manaCost: '', typeLine: '', oracleText: '', power: '', toughness: '' });

    const refresh = async () => {
        const data = await customCards.list();
        if (data.cards) setSavedCards(data.cards);
        setLoading(false);
    };

    React.useEffect(() => { refresh(); }, []);

    const playOnBattlefield = (card) => {
        socket.emit('createCustomCard', {
            name: card.name,
            imageUrl: card.imageUrl,
            typeLine: card.typeLine,
            manaCost: card.manaCost,
            oracleText: card.oracleText,
            power: card.power,
            toughness: card.toughness,
            colors: card.colors,
        }, () => {});
        onClose();
    };

    const handleSave = async () => {
        if (editing._id) {
            await customCards.update(editing._id, editing);
        } else {
            await customCards.create(editing);
        }
        await refresh();
        setEditing(null);
    };

    const handleDelete = async (id) => {
        const ok = await dialog.confirm('Delete this custom card?', { title: 'Delete custom card', danger: true, confirmLabel: 'Delete' });
        if (!ok) return;
        await customCards.delete(id);
        await refresh();
    };

    if (editing) {
        return (
            <div className="modal-overlay">
                <div className="modal custom-card-modal">
                    <div className="modal-header">
                        <h2>{editing._id ? 'Edit' : 'Create'} Custom Card</h2>
                        <button className="close-btn" onClick={() => setEditing(null)}>x</button>
                    </div>
                    <input type="text" placeholder="Card name" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
                    <input type="text" placeholder="Image URL" value={editing.imageUrl} onChange={e => setEditing({ ...editing, imageUrl: e.target.value })} />
                    <input type="text" placeholder="Mana cost (e.g. {2}{W}{W})" value={editing.manaCost} onChange={e => setEditing({ ...editing, manaCost: e.target.value })} />
                    <input type="text" placeholder="Type line (e.g. Creature — Elf Warrior)" value={editing.typeLine} onChange={e => setEditing({ ...editing, typeLine: e.target.value })} />
                    <textarea placeholder="Oracle text" value={editing.oracleText} onChange={e => setEditing({ ...editing, oracleText: e.target.value })} rows={4} />
                    <div className="pt-row">
                        <input type="text" placeholder="Power" value={editing.power} onChange={e => setEditing({ ...editing, power: e.target.value })} />
                        <input type="text" placeholder="Toughness" value={editing.toughness} onChange={e => setEditing({ ...editing, toughness: e.target.value })} />
                    </div>
                    <div className="modal-actions">
                        <button onClick={() => setEditing(null)}>Cancel</button>
                        <button onClick={handleSave} className="primary-btn">Save</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-overlay">
            <div className="modal custom-card-modal">
                <div className="modal-header">
                    <h2>Custom Cards</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <button onClick={() => setEditing(blankCard())} className="primary-btn">+ New Custom Card</button>
                {loading ? <p className="muted">Loading...</p> : savedCards.length === 0 ? (
                    <p className="muted">No custom cards yet.</p>
                ) : (
                    <div className="custom-card-list">
                        {savedCards.map(card => (
                            <div key={card._id} className="custom-card-row">
                                {card.imageUrl && <img src={card.imageUrl} alt={card.name} className="custom-card-thumb" />}
                                <div className="custom-card-info">
                                    <strong>{card.name}</strong>
                                    {card.manaCost && <span className="custom-card-mana"><ManaCost cost={card.manaCost} /></span>}
                                    <div className="muted">{card.typeLine}</div>
                                </div>
                                <div className="custom-card-actions">
                                    <button onClick={() => playOnBattlefield(card)} className="small-btn">Play</button>
                                    <button onClick={() => setEditing(card)} className="small-btn">Edit</button>
                                    <button onClick={() => handleDelete(card._id)} className="small-btn danger">Delete</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function BackgroundModal({ onClose }) {
    useEscapeKey(onClose);
    const [url, setUrl] = useState('');

    const handleSet = () => {
        socket.emit('setBackground', { imageUrl: url }, () => {});
        onClose();
    };

    return (
        <div className="modal-overlay">
            <div className="modal">
                <div className="modal-header">
                    <h2>Set Background</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <input type="text" placeholder="Image URL" value={url} onChange={e => setUrl(e.target.value)} />
                <div className="modal-actions">
                    <button onClick={handleSet} className="primary-btn">Set</button>
                    <button onClick={() => { socket.emit('setBackground', { imageUrl: null }); onClose(); }}>Clear</button>
                </div>
            </div>
        </div>
    );
}

// ─── Big-batch modals (settings, mana picker, card-field editor, emblems,
// browse library, reveal picker, mulligan bottom, stack panel). All use the
// existing modal-overlay/modal class pattern so they pick up the existing
// theme automatically — no new top-level layout. ─────────────────────────

function SettingsModal({ settings, isHost, sharedTeamLife, teams, me, onClose }) {
    useEscapeKey(onClose);
    const [draft, setDraft] = useState({
        startingLife: settings?.startingLife ?? 40,
        commanderDamageLethal: settings?.commanderDamageLethal ?? 21,
        maxPlayers: settings?.maxPlayers ?? 8,
        format: settings?.format ?? 'commander',
        mulliganRules: settings?.mulliganRules ?? 'vancouver',
        handSizeLimit: settings?.handSizeLimit ?? 7,
    });
    const [shared, setShared] = useState(!!sharedTeamLife);
    const [teamId, setTeamId] = useState(me?.teamId || '');
    // Prefer the persisted choice over whatever the server currently has, so
    // opening Settings shows the user's actual preference immediately.
    const [colorDraft, setColorDraft] = useState(() => {
        try {
            const stored = localStorage.getItem(`mtg_avatarColor_${me?.userId || 'anon'}`);
            if (stored && /^#[0-9a-fA-F]{6}$/.test(stored)) return stored;
        } catch (_) {}
        return me?.avatarColor || '#7986cb';
    });

    // Format presets — applied to draft locally; user clicks Save to commit.
    const applyFormat = (fmt) => {
        const presets = {
            commander: { startingLife: 40, commanderDamageLethal: 21 },
            brawl: { startingLife: 30, commanderDamageLethal: 21 },
            modern: { startingLife: 20, commanderDamageLethal: 21 },
            oathbreaker: { startingLife: 20, commanderDamageLethal: 21 },
            free: { startingLife: 40, commanderDamageLethal: 21 },
        };
        const preset = presets[fmt] || presets.commander;
        setDraft(d => ({ ...d, format: fmt, ...preset }));
    };

    const save = () => {
        if (isHost) {
            socket.emit('updateRoomSettings', { settings: draft });
            socket.emit('setSharedTeamLife', { value: shared });
        }
        if (teamId !== (me?.teamId || '')) {
            socket.emit('setTeam', { playerId: me?.userId, teamId: teamId || null, teamName: `Team ${teamId}` });
        }
        if (colorDraft && /^#[0-9a-fA-F]{6}$/.test(colorDraft)) {
            if (colorDraft !== me?.avatarColor) {
                socket.emit('setAvatarColor', { color: colorDraft });
            }
            // Persist the choice keyed by userId so it survives leaving the
            // room, joining a new one, or refreshing. The reconciler effect in
            // GameBoard re-applies it after every join.
            try { localStorage.setItem(`mtg_avatarColor_${me?.userId || 'anon'}`, colorDraft); } catch (_) {}
        }
        onClose();
    };

    return (
        <div className="modal-overlay">
            <div className="modal settings-modal">
                <div className="modal-header">
                    <h2>Game Settings</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <p className="muted" style={{ marginTop: 0 }}>
                    Settings are pure tools — nothing is enforced. Host can change them mid-game; existing life totals stay as they are.
                </p>

                <div className="settings-section">
                    <strong>Format</strong>
                    <div className="settings-row">
                        {['commander', 'brawl', 'modern', 'oathbreaker', 'free'].map(f => (
                            <button
                                key={f}
                                className={`small-btn ${draft.format === f ? 'active' : ''}`}
                                onClick={() => isHost && applyFormat(f)}
                                disabled={!isHost}
                            >{f}</button>
                        ))}
                    </div>
                </div>

                <div className="settings-section">
                    <strong>Numbers</strong>
                    <label>Starting life
                        <input type="number" value={draft.startingLife} onChange={e => setDraft({ ...draft, startingLife: parseInt(e.target.value) || 0 })} disabled={!isHost} />
                    </label>
                    <label>Commander damage lethal
                        <input type="number" value={draft.commanderDamageLethal} onChange={e => setDraft({ ...draft, commanderDamageLethal: parseInt(e.target.value) || 0 })} disabled={!isHost} />
                    </label>
                    <label>Max players
                        <input type="number" value={draft.maxPlayers} onChange={e => setDraft({ ...draft, maxPlayers: parseInt(e.target.value) || 0 })} disabled={!isHost} />
                    </label>
                    <label>Hand-size limit
                        <input type="number" value={draft.handSizeLimit} onChange={e => setDraft({ ...draft, handSizeLimit: parseInt(e.target.value) || 0 })} disabled={!isHost} />
                    </label>
                </div>

                <div className="settings-section">
                    <strong>Mulligan rules</strong>
                    <div className="settings-row">
                        {[
                            ['vancouver', 'Vancouver (7→7→6→5)'],
                            ['london', 'London (always 7, bottom N)'],
                            ['free7', 'Free 7 (7→7→6→5→4)'],
                        ].map(([k, label]) => (
                            <button
                                key={k}
                                className={`small-btn ${draft.mulliganRules === k ? 'active' : ''}`}
                                onClick={() => isHost && setDraft({ ...draft, mulliganRules: k })}
                                disabled={!isHost}
                            >{label}</button>
                        ))}
                    </div>
                </div>

                <div className="settings-section">
                    <strong>Teams</strong>
                    <label className="settings-checkbox-row">
                        <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} disabled={!isHost} />
                        <span>Shared life across teammates {!isHost && <span className="muted">(host only)</span>}</span>
                    </label>
                    <div className="settings-team-picker">
                        <label>My team
                            {teams?.length > 0 ? (
                                <select value={teamId} onChange={e => setTeamId(e.target.value)}>
                                    <option value="">None</option>
                                    {teams.map(t => (
                                        <option key={t.teamId} value={t.teamId}>{t.name}</option>
                                    ))}
                                    <option value="__new__">+ New team...</option>
                                </select>
                            ) : (
                                <input type="text" value={teamId} onChange={e => setTeamId(e.target.value)} placeholder="Team name / ID" />
                            )}
                        </label>
                        {teamId === '__new__' && (
                            <label>New team name
                                <input type="text" autoFocus placeholder="e.g. Red, Alpha, 1" onChange={e => setTeamId(e.target.value)} />
                            </label>
                        )}
                    </div>
                    {teams?.length > 0 && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                            Teams: {teams.map(t => t.name).join(', ')}
                        </div>
                    )}
                </div>

                <div className="settings-section">
                    <strong>My avatar color</strong>
                    <div className="avatar-color-row">
                        <input type="color" className="avatar-color-swatch" value={colorDraft} onChange={e => setColorDraft(e.target.value)} />
                        <span className="avatar-color-preview" style={{ background: colorDraft }} />
                    </div>
                </div>

                <div className="modal-actions">
                    <button onClick={onClose}>Cancel</button>
                    <button onClick={save} className="primary-btn">Save</button>
                </div>
            </div>
        </div>
    );
}

function CardFieldEditorModal({ card, field, onClose, onSubmit }) {
    useEscapeKey(onClose);
    const initial = (card[field] ?? 0) || 0;
    const [val, setVal] = useState(String(initial));
    const labels = { damage: 'Marked damage', suspendCounters: 'Suspend / time counters' };
    return (
        <div className="modal-overlay">
            <div className="modal small-modal">
                <div className="modal-header">
                    <h3>{labels[field] || field}</h3>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <p className="muted">{card.name}</p>
                <input
                    type="number"
                    value={val}
                    onChange={e => setVal(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && onSubmit(parseInt(val) || 0)}
                    autoFocus
                />
                <div className="modal-actions">
                    <button onClick={onClose}>Cancel</button>
                    <button className="primary-btn" onClick={() => onSubmit(parseInt(val) || 0)}>Set</button>
                </div>
            </div>
        </div>
    );
}

function EmblemAdderModal({ targetPlayerId, onClose, onSubmit }) {
    useEscapeKey(onClose);
    const [name, setName] = useState('');
    const [text, setText] = useState('');
    return (
        <div className="modal-overlay">
            <div className="modal">
                <div className="modal-header">
                    <h3>Add emblem</h3>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <input type="text" placeholder="Emblem name (e.g. 'Teferi emblem')" value={name} onChange={e => setName(e.target.value)} autoFocus />
                <textarea placeholder="Effect text" value={text} onChange={e => setText(e.target.value)} rows={4} />
                <div className="modal-actions">
                    <button onClick={onClose}>Cancel</button>
                    <button className="primary-btn" disabled={!name.trim()} onClick={() => onSubmit({ name: name.trim(), oracleText: text.trim() })}>Add</button>
                </div>
            </div>
        </div>
    );
}

function BrowseLibraryModal({ player, library, onClose, onMaximizeCard, onSteal }) {
    useEscapeKey(onClose);
    const [filter, setFilter] = useState('');
    const filtered = filter
        ? library.filter(c => (c.name || '').toLowerCase().includes(filter.toLowerCase()))
        : library;
    return (
        <div className="modal-overlay">
            <div className="modal browse-library-modal">
                <div className="modal-header">
                    <h3>{player.username}'s library ({library.length} cards)</h3>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <input type="text" placeholder="Filter by name" value={filter} onChange={e => setFilter(e.target.value)} autoFocus />
                <p className="muted">Click "Take" to put a card on your battlefield (Bribery / Acquire). Click the card to view it.</p>
                <div className="revealed-hand-grid">
                    {filtered.map(c => (
                        <div key={c.instanceId} className="revealed-hand-card">
                            <Card card={c} onClick={() => onMaximizeCard(c)} />
                            <div className="revealed-hand-name">{c.name}</div>
                            <button className="small-btn primary-btn" onClick={() => onSteal(c)}>Take</button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function RevealHandPickerModal({ hand, targets, onClose, onSubmit }) {
    useEscapeKey(onClose);
    const [picked, setPicked] = useState(new Set());
    const [target, setTarget] = useState('all');
    const toggle = (id) => {
        setPicked(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    return (
        <div className="modal-overlay">
            <div className="modal">
                <div className="modal-header">
                    <h3>Reveal which cards from your hand?</h3>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <div className="reveal-target-row">
                    <label>To:</label>
                    <select value={target} onChange={e => setTarget(e.target.value)}>
                        <option value="all">All players</option>
                        {targets.map(t => <option key={t.userId} value={t.userId}>{t.username}</option>)}
                    </select>
                </div>
                <div className="revealed-hand-grid">
                    {hand.map(c => (
                        <div key={c.instanceId} className={`revealed-hand-card ${picked.has(c.instanceId) ? 'selected' : ''}`} onClick={() => toggle(c.instanceId)}>
                            <Card card={c} />
                            <div className="revealed-hand-name">{c.name}</div>
                        </div>
                    ))}
                </div>
                <div className="modal-actions">
                    <button onClick={onClose}>Cancel</button>
                    <button className="primary-btn" disabled={picked.size === 0} onClick={() => onSubmit({
                        instanceIds: Array.from(picked),
                        targetPlayerIds: target === 'all' ? 'all' : [target],
                    })}>Reveal {picked.size}</button>
                </div>
            </div>
        </div>
    );
}

function MulliganBottomModal({ hand, need, onSubmit }) {
    const [picked, setPicked] = useState([]);
    const toggle = (id) => {
        setPicked(prev => {
            const idx = prev.indexOf(id);
            if (idx !== -1) return prev.filter(x => x !== id);
            if (prev.length >= need) return prev; // can't exceed
            return [...prev, id];
        });
    };
    return (
        <div className="modal-overlay" style={{ zIndex: 1500 }}>
            <div className="modal">
                <div className="modal-header">
                    <h3>Bottom {need} card(s) — London mulligan</h3>
                </div>
                <p className="muted">Pick {need - picked.length} more — these will go on the bottom of your library in the order you click them.</p>
                <div className="revealed-hand-grid">
                    {hand.map((c, i) => {
                        const order = picked.indexOf(c.instanceId);
                        return (
                            <div key={c.instanceId} className={`revealed-hand-card ${order !== -1 ? 'selected' : ''}`} onClick={() => toggle(c.instanceId)}>
                                <Card card={c} />
                                <div className="revealed-hand-name">{c.name}</div>
                                {order !== -1 && <div className="bottom-order-badge">#{order + 1}</div>}
                            </div>
                        );
                    })}
                </div>
                <div className="modal-actions">
                    <button className="primary-btn" disabled={picked.length !== need} onClick={() => onSubmit(picked)}>
                        Bottom {picked.length}/{need}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ProliferateModal({ players, onClose, onSubmit }) {
    useEscapeKey(onClose);
    // Each counter on each player/card is its own row — no dropdowns, just
    // a flat list of checkboxes. One row = one counter to bump.
    // Shape: { key, label, counterName, value, type, id, selected }
    const [items, setItems] = useState(() => {
        const list = [];
        for (const p of players) {
            const std = [
                ['poison', (p.counters || {}).poison || 0],
                ['energy', (p.counters || {}).energy || 0],
                ['experience', (p.counters || {}).experience || 0],
                ['infect', p.infect || 0],
            ];
            for (const [k, v] of Object.entries(p.counters || {})) {
                if (!['poison', 'energy', 'experience'].includes(k)) std.push([k, v || 0]);
            }
            for (const [name, value] of std) {
                list.push({ key: `p-${p.userId}-${name}`, label: p.username, counterName: name, value, type: 'player', id: p.userId, selected: false });
            }
            for (const card of (p.zones?.battlefield || [])) {
                for (const [name, value] of Object.entries(card.counters || {})) {
                    if (value > 0) {
                        list.push({ key: `c-${card.instanceId}-${name}`, label: card.name || 'Card', counterName: name, value, type: 'card', id: card.instanceId, selected: false });
                    }
                }
            }
        }
        return list;
    });

    const toggle = (key) => setItems(prev => prev.map(it => it.key === key ? { ...it, selected: !it.selected } : it));

    const submit = () => {
        const targets = items.filter(it => it.selected).map(it => ({ type: it.type, id: it.id, counter: it.counterName }));
        onSubmit(targets);
    };

    const selected = items.filter(it => it.selected).length;

    return (
        <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: 500, maxHeight: '80vh', overflowY: 'auto' }}>
                <div className="modal-header">
                    <h3>Proliferate</h3>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <p className="muted" style={{ marginTop: 0 }}>
                    Check each counter you want to add +1 to.
                </p>
                {items.length === 0 && <p className="muted">No counters in play.</p>}
                <div className="proliferate-list">
                    {items.map(it => (
                        <label key={it.key} className={`proliferate-row ${it.selected ? '' : 'deselected'}`}>
                            <input type="checkbox" checked={it.selected} onChange={() => toggle(it.key)} />
                            <span className="proliferate-name">{it.label}</span>
                            <span className="proliferate-counter">{it.counterName} ({it.value} → {it.value + 1})</span>
                        </label>
                    ))}
                </div>
                <div className="modal-actions">
                    <button onClick={onClose}>Cancel</button>
                    <button className="primary-btn" onClick={submit} disabled={selected === 0}>
                        Proliferate ({selected})
                    </button>
                </div>
            </div>
        </div>
    );
}

function StackPanel({ stack, isSpectator, onClose, onPop, onClear }) {
    return (
        <div className="stack-panel" role="dialog" aria-label="The Stack">
            <div className="stack-panel-head">
                <strong>Stack ({stack.length})</strong>
                {!isSpectator && <button className="small-btn" onClick={onClear}>Clear</button>}
                <button className="small-btn" onClick={onClose}>Hide</button>
            </div>
            <ol className="stack-list">
                {stack.slice().reverse().map((entry, i) => {
                    const realIndex = stack.length - 1 - i;
                    return (
                        <li key={entry.id} className={`stack-entry ${i === 0 ? 'top' : ''}`}>
                            <div className="stack-entry-name">{entry.name}</div>
                            <div className="stack-entry-caster muted">{entry.casterName}</div>
                            {!isSpectator && i === 0 && (
                                <button className="small-btn" onClick={() => onPop(realIndex)}>Resolve</button>
                            )}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
