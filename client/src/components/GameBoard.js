import React, { useState, useCallback, useEffect, useRef } from 'react';
import socket from '../socket';
import { decks, customCards } from '../api';
import PlayerZone from './PlayerZone';
import CardSearch from './CardSearch';
import CardMaximized from './CardMaximized';
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
    // Live cursor sharing. Only meaningful for non-touch + non-compact desktop
    // users because compact mode and mobile have layouts that don't line up
    // with the default desktop grid. Persisted so the user's preference
    // survives reloads.
    const [cursorShareEnabled, setCursorShareEnabled] = useState(() => {
        try { return localStorage.getItem('mtg_cursorShare') !== '0'; }
        catch (_) { return true; }
    });
    const gameBoardRef = useRef(null);
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
            socket.emit('cursorMove', { x, y, aspectRatio: rect.width / rect.height });
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

    const handleViewLibrary = () => {
        setLibrarySortMode('alphabetical');
        setLibrarySearchOpen(true);
    };

    const handleTutor = () => {
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
            { divider: true },
            {
                label: 'Reveal hand to all',
                onClick: () => socket.emit('revealHand', { targetPlayerIds: 'all' }, () => {}),
            },
            ...gameState.players.filter(p => p.userId !== user.id).map(p => ({
                label: `Reveal hand to ${p.username}`,
                onClick: () => socket.emit('revealHand', { targetPlayerIds: [p.userId] }, () => {}),
            })),
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
    const myMulliganCount = me?.mulliganCount || 0;
    // Mulligan sequence: initial draw 7 → mulligan 1 draws 7 → 2 draws 6 →
    // 3 draws 5 → blocked. Allow up to 3 mulligans total.
    const canMulligan = !gameStarted || myMulliganCount < 3;

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
                    <span className="turn-info">
                        Turn: <strong>{turnPlayer?.username || '?'}</strong>
                    </span>
                    {gameStarted && !isSpectator && (
                        <button onClick={handleNextTurn} className="small-btn turn-end-btn">End Turn</button>
                    )}
                    {isSpectator && <span className="spectator-badge">Spectating</span>}
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
                        <>
                            <button onClick={handleUntapAll} className="small-btn">Untap All</button>
                            <button onClick={handleUndo} className="small-btn">Undo</button>
                            <button onClick={() => setShowSearch('token')} className="small-btn">Tokens</button>
                            <button onClick={() => setShowSearch('add')} className="small-btn">Search</button>
                            <button onClick={handleViewLibrary} className="small-btn">View Deck</button>
                            <button onClick={handleMulligan} className="small-btn" disabled={!canMulligan} title={canMulligan ? `Mulligan (draws ${Math.max(5, 8 - (myMulliganCount + 1))} next)` : 'No more mulligans'}>Mulligan</button>
                            <button onClick={() => setShowDicePicker(true)} className="small-btn">Roll</button>
                            <button onClick={() => setCustomCardModal(true)} className="small-btn">Custom</button>
                        </>
                    )}
                    {!isSpectator && (
                        <button onClick={() => setBgModal(true)} className="small-btn">BG</button>
                    )}
                    <button onClick={() => setGuideOpen(true)} className="small-btn" title="How to play">Guide</button>
                    <button onClick={() => setActionLogOpen(o => !o)} className="small-btn" title="Action log">Log</button>
                    {!isTouch && (
                        <label className="compact-toggle small-btn" title="Share cursor with other desktop players (non-compact only)">
                            <input type="checkbox" checked={cursorShareEnabled} onChange={e => setCursorShareEnabled(e.target.checked)} />
                            Cursor
                        </label>
                    )}
                    <label className="compact-toggle small-btn" title="Toggle compact layout">
                        <input type="checkbox" checked={compactMode} onChange={e => setCompactMode(e.target.checked)} />
                        Compact
                    </label>
                    <button onClick={onLeave} className="small-btn danger">Leave</button>
                </div>
            </div>

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
                    {/* Single-card-only actions (only meaningful for one card at a time) */}
                    {selectedIds.size === 1 && firstSelectedCard && (
                        <>
                            <button onClick={() => setMaximizedCard(firstSelectedCard)}>View</button>
                            <button onClick={() => setCounterModalCard(firstSelectedCard)}>+Counter</button>
                            <button onClick={() => setNoteEditor({ instanceId: firstSelectedCard.instanceId })}>Note</button>
                            {firstSelectedCard.backImageUri ? (
                                <button onClick={() => socket.emit('flipCard', { instanceId: firstSelectedCard.instanceId })}>
                                    {firstSelectedCard.flipped ? 'Front' : 'Back'}
                                </button>
                            ) : (
                                <button onClick={() => socket.emit('toggleFaceDown', { instanceId: firstSelectedCard.instanceId })}>
                                    {firstSelectedCard.faceDown ? 'Face up' : 'Face down'}
                                </button>
                            )}
                            <button onClick={() => socket.emit('revealCard', { instanceId: firstSelectedCard.instanceId, targetPlayerIds: 'all' })}>Reveal</button>
                        </>
                    )}
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
            />

            {/* Chat — always rendered, collapsible */}
            <Chat
                messages={gameState.chat || []}
                currentUserId={user.id}
                open={chatOpen}
                onToggle={() => setChatOpen(o => !o)}
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
                <Cursors containerRef={gameBoardRef} currentUserId={user.id} />
            )}

            {/* Guide / How-to-play */}
            {guideOpen && <Guide onClose={() => setGuideOpen(false)} />}

            {/* Revealed hand viewer — fired by handRevealed socket event */}
            {revealedHand && (
                <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onDismissRevealedHand(); }}>
                    <div className="modal revealed-hand-modal">
                        <div className="modal-header">
                            <h3>{revealedHand.revealedByName || 'Someone'} revealed their hand</h3>
                            <button className="close-btn" onClick={onDismissRevealedHand}>x</button>
                        </div>
                        <div className="revealed-hand-grid">
                            {(revealedHand.cards || []).length === 0 && <div className="muted">Empty hand.</div>}
                            {(revealedHand.cards || []).map((c, i) => (
                                <div key={c.instanceId || i} className="revealed-hand-card">
                                    {c.imageUri && <img src={c.imageUri} alt={c.name} />}
                                    <div className="revealed-hand-name">{c.name}</div>
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
            {maximizedCard && (
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
                />
            )}
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
                        socket.emit('setCardCounter', { instanceId: counterModalCard.instanceId, counter: name, value: val });
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
                        <div key={r.id} className="roll-result-toast">
                            <strong>{r.playerName}</strong>{' '}
                            {r.type === 'coin'
                                ? `flipped ${r.count > 1 ? r.count + ' coins' : 'a coin'}: ${r.results.join(', ')}`
                                : `rolled ${r.count}d${r.sides}: ${r.results.join(', ')}${r.count > 1 ? ' = ' + r.total : ''}`
                            }
                        </div>
                    ))}
                </div>
            )}
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
