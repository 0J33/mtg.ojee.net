import React, { useState, useRef, useEffect, useCallback } from 'react';
import socket from '../socket';
import Card from './Card';
import ContextMenu from './ContextMenu';
import NoteEditor from './NoteEditor';
import CounterModal from './CounterModal';
import { useDialog } from './Dialog';
import { useEscapeKey, useHorizontalWheel, fmtNum, parseGameValue, isInfinite, INFINITE } from '../utils';

// Color order used by the mana pool widget — matches the WUBRG convention
// most MTG players expect, with colorless on the right.
const MANA_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'];

// Manual mana counter — always visible for the owner, shows each WUBRG+C
// color with +/- buttons. Other players only see it when non-zero. The user
// adds/removes mana manually; there's no automatic tap-for-mana flow.
function ManaPoolWidget({ pool, isOwner, playerId, spectating }) {
    if (!pool) return null;
    const totals = MANA_COLORS.map(c => [c, pool[c] || 0]);
    const anyMana = totals.some(([, v]) => v > 0);
    // Opponents see nothing when the pool is empty.
    if (!isOwner && !anyMana) return null;
    const adjust = (color, delta) => {
        if (spectating) return;
        socket.emit('addMana', { targetPlayerId: playerId, color, amount: delta });
    };
    return (
        <div className="mana-pool-widget" title="Mana pool — click + to add, - to spend">
            {MANA_COLORS.map(c => {
                const v = pool[c] || 0;
                // For opponents, skip colors with 0 to save space.
                if (!isOwner && v === 0) return null;
                return (
                    <span key={c} className={`mana-pool-pip mana-${c} ${v > 0 ? 'has-mana' : ''}`}>
                        {isOwner && !spectating && (
                            <button className="mana-btn" onClick={() => adjust(c, -1)} disabled={v <= 0}>-</button>
                        )}
                        <img src={`https://svgs.scryfall.io/card-symbols/${c}.svg`} alt={c} className="mana-sym-img" />
                        <span className="mana-pool-count">{v}</span>
                        {isOwner && !spectating && (
                            <button className="mana-btn" onClick={() => adjust(c, 1)}>+</button>
                        )}
                    </span>
                );
            })}
            {isOwner && anyMana && !spectating && (
                <button
                    className="mana-pool-clear"
                    title="Empty mana pool"
                    onClick={() => socket.emit('clearManaPool', { targetPlayerId: playerId })}
                >×</button>
            )}
        </div>
    );
}

function fmtTimer(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

const COMMANDER_FORMATS = new Set(['commander', 'brawl', 'oathbreaker']);

export default function PlayerZone({ player, isOwner, userId, allPlayers, onMaximizeCard, onScry, onTutor, onPlayerContextMenu, onViewLibrary, selectedIds, onToggleSelect, onClearSelection, compact, isCurrentTurn, touchMode, spectating, gameStarted, onCloneCard, onShowCardFieldEditor, onTakeControl, onCastFromZone, onForetellCard, onCastForetold, cumulativeTurnTime, currentTurnElapsed, pendingAction, onStartPendingAction, onResolvePendingCard, onResolvePendingPlayer, optimisticUpdateCard, optimisticUpdatePlayer, touchInteractMode, format, piles }) {
    const dialog = useDialog();
    const hasCommanderZone = COMMANDER_FORMATS.has(format || 'commander');
    // Turn-start nudges: on the self-zone only, once the game has started and
    // it's actually your turn, glow the draw button until you've drawn and
    // glow each land card in hand until you've played a land. Purely visual
    // hints — nothing is enforced.
    const needsDraw = isOwner && gameStarted && isCurrentTurn && !player.drewThisTurn;
    const needsLand = isOwner && gameStarted && isCurrentTurn && (player.landsPlayedThisTurn || 0) === 0;
    const isLandCard = (card) => {
        const t = (card?.typeLine || '').toLowerCase();
        return t.includes('land');
    };
    const [contextMenu, setContextMenu] = useState(null);
    const [expandedZone, setExpandedZone] = useState(null);
    const [editingLife, setEditingLife] = useState(false);
    const [lifeInput, setLifeInput] = useState('');
    const [counterModal, setCounterModal] = useState(null);
    const [noteEditor, setNoteEditor] = useState(null);
    const [collapsedRows, setCollapsedRows] = useState(new Set());

    // ── Touch drag system ──────────────────────────────────────
    // Long-press (300ms) a card to start dragging on touch devices.
    // A floating ghost follows the finger; releasing over a zone
    // (identified by data-drop-zone) emits moveCard.
    //
    // Key details:
    //  - touchDragRef.started distinguishes "timer pending" from "drag active"
    //  - Movement < 10px doesn't cancel the pending timer (finger wiggle)
    //  - Once drag starts, contextmenu is suppressed (Android long-press menu)
    //  - On touchend after drag, a flag suppresses the synthetic click event
    const touchDragRef = useRef(null);
    const touchTimerRef = useRef(null);
    const touchDragDidDropRef = useRef(false); // suppresses click after drop

    const cleanupTouchDrag = useCallback(() => {
        if (touchTimerRef.current) { clearTimeout(touchTimerRef.current); touchTimerRef.current = null; }
        const td = touchDragRef.current;
        if (td) {
            if (td.ghost?.parentNode) td.ghost.parentNode.removeChild(td.ghost);
            if (td.highlightEl) td.highlightEl.classList.remove('touch-drop-highlight');
        }
        touchDragRef.current = null;
    }, []);

    useEffect(() => cleanupTouchDrag, [cleanupTouchDrag]);

    const onTouchStartCard = useCallback((e, card, zone) => {
        if (!touchMode || !isOwner || spectating) return;
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        const startX = touch.clientX;
        const startY = touch.clientY;
        const cardEl = e.currentTarget.querySelector('.card') || e.currentTarget;
        const imgEl = cardEl.querySelector('img');

        // Store start position so we can check distance in touchmove
        touchDragRef.current = { startX, startY, started: false };

        touchTimerRef.current = setTimeout(() => {
            const ghost = document.createElement('div');
            ghost.className = 'touch-drag-ghost';
            if (imgEl) {
                const img = document.createElement('img');
                img.src = imgEl.src;
                ghost.appendChild(img);
            } else {
                ghost.textContent = card.name || '?';
            }
            ghost.style.left = startX + 'px';
            ghost.style.top = startY + 'px';
            document.body.appendChild(ghost);

            touchDragRef.current = {
                instanceId: card.instanceId,
                fromZone: zone,
                fromPlayerId: player.userId,
                ghost,
                highlightEl: null,
                started: true,
            };
            if (navigator.vibrate) navigator.vibrate(30);
        }, 300);
    }, [touchMode, isOwner, spectating, player.userId]);

    const onTouchMoveCard = useCallback((e) => {
        const td = touchDragRef.current;
        if (!td) return;

        const touch = e.touches[0];

        // Before drag starts: cancel if finger moved > 10px (it's a scroll)
        if (!td.started) {
            const dx = touch.clientX - td.startX;
            const dy = touch.clientY - td.startY;
            if (dx * dx + dy * dy > 100) {
                clearTimeout(touchTimerRef.current);
                touchTimerRef.current = null;
                touchDragRef.current = null;
            }
            return;
        }

        // Drag is active — move ghost and highlight zones
        e.preventDefault();
        td.ghost.style.left = touch.clientX + 'px';
        td.ghost.style.top = touch.clientY + 'px';

        td.ghost.style.pointerEvents = 'none';
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        td.ghost.style.pointerEvents = '';
        const zoneEl = el?.closest?.('[data-drop-zone]');
        if (td.highlightEl && td.highlightEl !== zoneEl) {
            td.highlightEl.classList.remove('touch-drop-highlight');
        }
        if (zoneEl) {
            zoneEl.classList.add('touch-drop-highlight');
            td.highlightEl = zoneEl;
        } else {
            td.highlightEl = null;
        }
    }, []);

    const onTouchEndCard = useCallback((e) => {
        if (touchTimerRef.current) { clearTimeout(touchTimerRef.current); touchTimerRef.current = null; }
        const td = touchDragRef.current;
        if (!td || !td.started) {
            // No drag was active — let normal tap/click handlers fire
            touchDragRef.current = null;
            return;
        }

        // Drag was active — prevent the synthetic click that follows touchend
        e.preventDefault();

        const touch = e.changedTouches[0];
        if (td.ghost) td.ghost.style.pointerEvents = 'none';
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const zoneEl = el?.closest?.('[data-drop-zone]');
        if (zoneEl) {
            const toZone = zoneEl.getAttribute('data-drop-zone');
            const toPlayerId = zoneEl.getAttribute('data-drop-player');
            if (toZone) {
                socket.emit('moveCard', {
                    instanceId: td.instanceId,
                    fromZone: td.fromZone,
                    toZone,
                    targetPlayerId: toPlayerId || player.userId,
                });
            }
        }
        cleanupTouchDrag();
        // Flag to suppress the click event that some browsers still fire
        touchDragDidDropRef.current = true;
        setTimeout(() => { touchDragDidDropRef.current = false; }, 400);
    }, [player.userId, cleanupTouchDrag]);

    // Suppress Android's native long-press context menu when a drag is pending/active
    const onContextMenuCard = useCallback((e) => {
        if (touchDragRef.current) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, []);

    useEscapeKey(() => {
        if (expandedZone) setExpandedZone(null);
    });

    const toggleRow = (key) => {
        setCollapsedRows(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    // Middle-click (button 1) toggles tap/untap on any card, anywhere.
    const handleCardMouseDown = (e, card) => {
        if (e.button !== 1) return; // only middle click
        e.preventDefault();
        if (spectating) return;
        // Optimistic: toggle locally before server confirms
        optimisticUpdateCard?.(card.instanceId, c => ({ ...c, tapped: !c.tapped }));
        socket.emit('tapCard', { instanceId: card.instanceId });
    };

    // Ctrl+drag multi-select: when ctrl (or cmd) is held and the mouse enters
    // a card, add it to selection automatically. This lets the user paint a
    // selection by sweeping across cards while holding ctrl.
    const handleCardMouseEnter = (e, card) => {
        if (spectating) return;
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.buttons !== 1) return; // left button must be held (dragging)
        onToggleSelect?.(card.instanceId);
    };

    const handleCardClick = (e, card) => {
        // After a touch drag drop, the browser fires a synthetic click — ignore it.
        if (touchDragDidDropRef.current) return;
        // When a pending action is active, card clicks resolve it instead of
        // any normal behavior (selection, maximize, etc.). For attach, only
        // allow clicking battlefield cards (not command zone / hand / etc).
        if (pendingAction && (pendingAction.type === 'attach') && onResolvePendingCard) {
            const isOnBf = allBfCards.some(c => c.instanceId === card.instanceId);
            if (isOnBf) {
                e.preventDefault();
                e.stopPropagation();
                onResolvePendingCard(card);
                return;
            }
            // Not on battlefield — ignore the click and let normal behavior
            // continue (opens maximize view instead).
        }
        // Spectators can only view cards — skip selection logic entirely and
        // go straight to the maximized viewer.
        if (spectating) {
            e.preventDefault();
            e.stopPropagation();
            onMaximizeCard(card);
            return;
        }
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect?.(card.instanceId);
            return;
        }
        // Touch devices: behavior depends on the active touch mode.
        //   'normal' = tap maximizes/views the card (like desktop left-click)
        //   'select' = tap toggles selection (like holding ctrl on desktop)
        //   'menu'   = tap opens the context menu (like right-click)
        if (touchMode) {
            e.preventDefault();
            e.stopPropagation();
            if (touchInteractMode === 'menu') {
                const zones = ['hand', 'battlefield', 'graveyard', 'exile', 'commandZone', 'sideboard', 'companions', 'foretell'];
                let cardZone = 'battlefield';
                for (const z of zones) {
                    const arr = player.zones[z];
                    if (Array.isArray(arr) && arr.some(c => c.instanceId === card.instanceId)) {
                        cardZone = z;
                        break;
                    }
                }
                const rect = e.currentTarget?.getBoundingClientRect?.() || { left: e.clientX || 100, bottom: (e.clientY || 100) + 4 };
                handleCardContext({
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    clientX: rect.left,
                    clientY: rect.bottom + 4,
                }, card, cardZone);
                return;
            }
            if (touchInteractMode === 'select') {
                onToggleSelect?.(card.instanceId);
                return;
            }
            // 'normal' — view the card (same as desktop click)
            if (selectedIds && selectedIds.size > 0) onClearSelection?.();
            onMaximizeCard(card);
            return;
        }
        // Normal desktop click — clear selection and maximize
        if (selectedIds && selectedIds.size > 0) onClearSelection?.();
        onMaximizeCard(card);
    };

    const handleCardContext = (e, card, zone) => {
        e.preventDefault();
        e.stopPropagation();
        if (spectating) return;
        const zones = ['hand', 'battlefield', 'graveyard', 'exile', 'commandZone'];

        const bfRowItems = (zone === 'battlefield') ? [
            { divider: true },
            { label: `Display in: Creatures${card.bfRow === 'creatures' ? ' ✓' : ''}`, onClick: () => socket.emit('setBfRow', { instanceId: card.instanceId, bfRow: 'creatures' }) },
            { label: `Display in: Artifacts${card.bfRow === 'artifacts' ? ' ✓' : ''}`, onClick: () => socket.emit('setBfRow', { instanceId: card.instanceId, bfRow: 'artifacts' }) },
            { label: `Display in: Lands${card.bfRow === 'lands' ? ' ✓' : ''}`, onClick: () => socket.emit('setBfRow', { instanceId: card.instanceId, bfRow: 'lands' }) },
            ...(card.bfRow ? [{ label: 'Display in: Auto', onClick: () => socket.emit('setBfRow', { instanceId: card.instanceId, bfRow: null }) }] : []),
        ] : [];

        // ─── Big batch additions: zone-aware menu items ────────────────

        // Cast from non-battlefield zones with optional auto-exile.
        const castFromZoneItems = (zone === 'graveyard' || zone === 'exile' || zone === 'foretell') ? [
            { divider: true },
            ...(zone === 'foretell' ? [
                { label: 'Cast (foretold)', onClick: () => onCastForetold?.(card) },
            ] : [
                { label: 'Cast → battlefield', onClick: () => onCastFromZone?.(card, zone, false) },
                { label: 'Cast → exile after (flashback / escape)', onClick: () => onCastFromZone?.(card, zone, true) },
            ]),
        ] : [];

        // Foretell from hand
        const foretellItems = (zone === 'hand') ? [
            { label: 'Foretell', onClick: () => onForetellCard?.(card) },
        ] : [];

        // Stack push — only from hand (cast a spell). Adds the card to the
        // room-level stack so other players see what you're casting before
        // you actually drag it onto the battlefield. Pure tool, no resolution.
        const stackPushItems = (zone === 'hand' && player.userId === userId) ? [
            { label: 'Push to stack', onClick: () => socket.emit('stackPush', {
                name: card.name,
                imageUri: card.imageUri,
                oracleText: card.oracleText,
                manaCost: card.manaCost,
                instanceId: card.instanceId,
            }) },
        ] : [];

        // Adventure cards — front face is the creature, "adventure" face is an
        // instant/sorcery printed below it. Detected by layout === 'adventure'
        // or the legacy " // " name pattern. "Cast adventure" pushes the
        // adventure side to the stack and exiles the card; the player can then
        // cast it from exile as the creature later (which is the MTG rule).
        const isAdventure = card.layout === 'adventure'
            || (typeof card.name === 'string' && card.name.includes(' // ')
                && /Adventure/i.test(card.typeLine || ''));
        const adventureName = isAdventure && card.name?.includes(' // ')
            ? card.name.split(' // ')[1]
            : null;
        const adventureItems = (zone === 'hand' && isAdventure && adventureName && player.userId === userId) ? [
            { label: `Cast adventure: ${adventureName}`, onClick: () => {
                socket.emit('stackPush', {
                    name: `${adventureName} (adventure)`,
                    imageUri: card.imageUri,
                    oracleText: card.oracleText,
                    manaCost: '',
                    instanceId: card.instanceId,
                });
                // After resolving, the card goes to exile per MTG rules. It
                // can then be cast as the creature side from exile via the
                // existing "Cast → battlefield" menu item on the exile zone.
                socket.emit('moveCard', {
                    instanceId: card.instanceId,
                    fromZone: 'hand',
                    toZone: 'exile',
                });
            }},
        ] : [];

        // Combat declaration — single "Declare attack..." item that enters
        // pick-target mode. The user then clicks an opponent's player header
        // to set the attack target. Avoids bloating the menu with N opponent entries.
        const combatItems = (zone === 'battlefield' && player.userId === userId) ? [
            { divider: true },
            {
                label: 'Declare attack...',
                onClick: () => onStartPendingAction?.({
                    type: 'attack',
                    sourceInstanceId: card.instanceId,
                    message: `Click an opponent to attack with ${card.name || 'this creature'}`,
                }),
            },
            ...(card.attackingPlayerId ? [{
                label: 'Stop attacking',
                onClick: () => socket.emit('setCardField', {
                    instanceId: card.instanceId,
                    field: 'attackingPlayerId',
                    value: null,
                }),
            }] : []),
        ] : [];

        // Equip / Attach — single "Attach to..." item that enters pick-target
        // mode. The user then clicks another battlefield card to set attachedTo.
        const attachItems = (zone === 'battlefield') ? [
            {
                label: 'Attach to...',
                onClick: () => onStartPendingAction?.({
                    type: 'attach',
                    sourceInstanceId: card.instanceId,
                    message: `Click a card to attach ${card.name || 'this card'} to`,
                }),
            },
            ...(card.attachedTo ? [
                { label: 'Detach', onClick: () => socket.emit('setCardField', { instanceId: card.instanceId, field: 'attachedTo', value: null }) },
            ] : []),
        ] : [];

        // Battlefield-only state actions
        const stateActionItems = (zone === 'battlefield') ? [
            { divider: true },
            { label: card.rotated180 ? 'Unrotate' : 'Rotate 180°', onClick: () => socket.emit('setCardField', { instanceId: card.instanceId, field: 'rotated180', value: !card.rotated180 }) },
            { label: card.phasedOut ? 'Phase in' : 'Phase out', onClick: () => socket.emit('setCardField', { instanceId: card.instanceId, field: 'phasedOut', value: !card.phasedOut }) },
            { label: card.goaded ? 'Remove goad' : 'Goad', onClick: () => socket.emit('setCardField', { instanceId: card.instanceId, field: 'goaded', value: !card.goaded }) },
            { label: `Mark damage... (${card.damage || 0})`, onClick: () => onShowCardFieldEditor?.(card, 'damage') },
            { label: `Suspend counters... (${card.suspendCounters || 0})`, onClick: () => onShowCardFieldEditor?.(card, 'suspendCounters') },
            { label: 'Clone (token)', onClick: () => onCloneCard?.(card) },
            ...attachItems,
            ...(card.controllerOriginal ? [
                { label: 'Return to original owner', onClick: () => socket.emit('moveCard', { instanceId: card.instanceId, fromZone: 'battlefield', toZone: 'battlefield', targetPlayerId: card.controllerOriginal }) },
            ] : []),
            // Take control on opponent's cards only — drawn from this player's
            // userId vs the card-owner's userId via the player param.
            ...(player.userId !== userId ? [
                { label: 'Take control (until end of turn)', onClick: () => onTakeControl?.(card, true) },
                { label: 'Take control (permanent)', onClick: () => onTakeControl?.(card, false) },
            ] : []),
        ] : [];

        const items = [
            { label: `View: ${card.name || 'Face-down'}`, onClick: () => onMaximizeCard(card) },
            {
                label: card.tapped ? 'Untap' : 'Tap',
                onClick: () => {
                    optimisticUpdateCard?.(card.instanceId, c => ({ ...c, tapped: !c.tapped }));
                    socket.emit('tapCard', { instanceId: card.instanceId });
                },
            },
            ...foretellItems,
            ...stackPushItems,
            ...adventureItems,
            ...bfRowItems,
            // Foil / textless are cosmetic — only the card's owner can change them.
            ...(isOwner ? [
                { label: 'Make foil', onClick: () => socket.emit('setCardField', { instanceId: card.instanceId, field: 'foil', value: 'foil' }), disabled: card.foil === 'foil' },
                { label: 'Make etched', onClick: () => socket.emit('setCardField', { instanceId: card.instanceId, field: 'foil', value: 'etched' }), disabled: card.foil === 'etched' },
                ...(card.foil ? [{ label: 'Remove effect', onClick: () => socket.emit('setCardField', { instanceId: card.instanceId, field: 'foil', value: null }) }] : []),
                { label: card.textless ? 'Hide oracle on hover' : 'Show oracle on hover', onClick: () => socket.emit('setCardField', { instanceId: card.instanceId, field: 'textless', value: !card.textless }) },
            ] : []),
            ...stateActionItems,
            ...combatItems,
            ...castFromZoneItems,
            { divider: true },
            ...zones.filter(z => z !== zone && z !== 'library' && (z !== 'commandZone' || hasCommanderZone)).map(z => ({
                label: `Move to ${z === 'commandZone' ? 'Command Zone' : z}`,
                onClick: () => socket.emit('moveCard', { instanceId: card.instanceId, fromZone: zone, toZone: z }),
            })),
            ...(zone !== 'library' ? [
                { label: 'To top of library', onClick: () => socket.emit('moveCard', { instanceId: card.instanceId, fromZone: zone, toZone: 'library', libraryPosition: 'top' }) },
                { label: 'To bottom of library', onClick: () => socket.emit('moveCard', { instanceId: card.instanceId, fromZone: zone, toZone: 'library' }) },
            ] : []),
            // Move to any shared pile. Each pile is a top-level menu item.
            ...((piles || []).map(p => ({
                label: `Move to pile: ${p.name}`,
                onClick: () => socket.emit('moveCard', { instanceId: card.instanceId, fromZone: zone, toZone: `pile:${p.id}` }),
            }))),
            { divider: true },
            // Single unified "Flip" action. DFC cards swap sides; one-sided
            // cards toggle face-down. One button for everything.
            {
                label: 'Flip',
                onClick: () => socket.emit(
                    card.backImageUri ? 'flipCard' : 'toggleFaceDown',
                    { instanceId: card.instanceId },
                ),
            },
            { divider: true },
            { label: 'Reveal to all', onClick: () => socket.emit('revealCard', { instanceId: card.instanceId, targetPlayerIds: 'all' }) },
            {
                label: 'Reveal to...',
                onClick: () => onStartPendingAction?.({
                    type: 'revealTo',
                    sourceInstanceId: card.instanceId,
                    message: `Click a player to reveal ${card.name || 'this card'} to`,
                }),
            },
            { divider: true },
            { label: 'Add counter...', onClick: () => setCounterModal({ instanceId: card.instanceId, card }) },
            ...(card.counters && Object.values(card.counters).some(v => v !== 0) ? [{
                label: 'Clear all counters',
                onClick: () => socket.emit('clearCardCounters', { instanceId: card.instanceId }),
            }] : []),
            { divider: true },
            {
                label: 'Add note / effect...',
                onClick: () => setNoteEditor({ instanceId: card.instanceId }),
            },
            ...(Array.isArray(card.notes) && card.notes.length > 0 ? [{
                label: `Clear ${card.notes.length} note(s)`,
                onClick: () => socket.emit('clearCardNotes', { instanceId: card.instanceId }),
            }] : []),
        ];
        setContextMenu({ x: e.clientX, y: e.clientY, items });
    };

    const handleLifeClick = () => {
        if (spectating) return;
        setEditingLife(true);
        setLifeInput(isInfinite(player.life) ? '∞' : String(player.life));
    };

    const handleLifeSubmit = () => {
        if (spectating) { setEditingLife(false); return; }
        const val = parseGameValue(lifeInput);
        if (!isNaN(val)) socket.emit('setLife', { targetPlayerId: player.userId, life: val });
        setEditingLife(false);
    };

    const adjustLife = (amount) => {
        if (spectating) return;
        // Optimistic: update locally before server confirms
        optimisticUpdatePlayer?.(player.userId, p => ({ ...p, life: p.life + amount }));
        socket.emit('adjustLife', { targetPlayerId: player.userId, amount });
    };

    const handleDragStart = (e, card, zone) => {
        e.dataTransfer.setData('application/json', JSON.stringify({
            instanceId: card.instanceId,
            fromZone: zone,
            fromPlayerId: player.userId,
        }));
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDrop = (e, toZone) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));
            if (!data.instanceId) return;
            socket.emit('moveCard', {
                instanceId: data.instanceId,
                fromZone: data.fromZone,
                toZone,
                targetPlayerId: player.userId,
            });
        } catch (err) { /* ignore */ }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const renderZoneCards = (cards, zone) => {
        if (!cards || cards.length === 0) return <div className="zone-empty">Empty</div>;
        return cards.map(card => {
            const isHidden = card.hidden;
            if (isHidden) return <div key={Math.random()} className="card card-hidden" />;
            const isSelected = selectedIds?.has(card.instanceId);
            const pendingLand = zone === 'hand' && needsLand && isLandCard(card);
            return (
                <div key={card.instanceId} className={`card-wrapper ${isSelected ? 'selected' : ''} ${pendingLand ? 'turn-nudge-land' : ''}`}
                    onMouseDown={(e) => handleCardMouseDown(e, card)}
                    onMouseEnter={(e) => handleCardMouseEnter(e, card)}
                    onTouchStart={(e) => onTouchStartCard(e, card, zone)}
                    onTouchMove={onTouchMoveCard}
                    onTouchEnd={onTouchEndCard}>
                    <Card
                        card={card}
                        onClick={(e) => handleCardClick(e, card)}
                        onContextMenu={(e) => { if (touchDragRef.current) { e.preventDefault(); e.stopPropagation(); return; } handleCardContext(e, card, zone); }}
                        draggable={isOwner && !touchMode}
                        onDragStart={(e) => handleDragStart(e, card, zone)}
                        attachedToName={attachedToName[card.instanceId]}
                        attachments={attachmentsOn[card.instanceId]}
                    />
                </div>
            );
        });
    };

    // Build attachment maps for the hover/effects panel. Two lookups:
    //   attachedToName: card.instanceId → name of the card it's attached TO
    //   attachmentsOn:  card.instanceId → [{name, imageUri}] of cards attached to it
    // We look across ALL players' battlefields so cross-player attachments
    // (enchanting an opponent's creature) resolve correctly.
    const allBfCards = [];
    for (const p of allPlayers) {
        for (const c of (p.zones?.battlefield || [])) allBfCards.push(c);
    }
    const bfById = {};
    for (const c of allBfCards) bfById[c.instanceId] = c;
    const attachedToName = {};
    const attachmentsOn = {};
    for (const c of allBfCards) {
        if (c.attachedTo) {
            const target = bfById[c.attachedTo];
            if (target) {
                attachedToName[c.instanceId] = target.name;
                if (!attachmentsOn[target.instanceId]) attachmentsOn[target.instanceId] = [];
                attachmentsOn[target.instanceId].push({ name: c.name, imageUri: c.imageUri });
            }
        }
    }

    const cmdDmgEntries = Object.entries(player.commanderDamageFrom || {});
    const lethalCmdDmg = hasCommanderZone && cmdDmgEntries.some(([, dmg]) => dmg >= 21);
    const totalInfect = player.infect || 0;
    const lethalInfect = totalInfect >= 10;
    const isDead = player.life <= 0 || lethalCmdDmg || lethalInfect;

    return (
        <div className={`player-zone ${isDead ? 'dead' : ''} ${compact ? 'compact' : ''} ${isCurrentTurn ? 'current-turn' : ''}`}>
            {player.background && (
                <div
                    className="player-zone-bg"
                    style={{ backgroundImage: `url(${player.background})` }}
                />
            )}
            {isDead && (
                <div className="death-banner">
                    {lethalCmdDmg ? 'KILLED BY COMMANDER' : lethalInfect ? 'POISONED' : 'ELIMINATED'}
                </div>
            )}
            <div className="player-header"
                onContextMenu={spectating ? undefined : onPlayerContextMenu}
                onClick={pendingAction && (pendingAction.type === 'attack' || pendingAction.type === 'revealTo' || pendingAction.type === 'revealHandTo') && player.userId !== userId
                    ? (e) => { e.stopPropagation(); onResolvePendingPlayer?.(player); }
                    : undefined}
                style={pendingAction && (pendingAction.type === 'attack' || pendingAction.type === 'revealTo' || pendingAction.type === 'revealHandTo') && player.userId !== userId
                    ? { cursor: 'crosshair' }
                    : undefined}
            >
                {player.avatarColor && (
                    <span
                        className="player-avatar-dot"
                        style={{ background: player.avatarColor }}
                        title={player.username}
                    />
                )}
                <span className={`player-name ${player.connected ? 'online' : 'offline'}`}>
                    {player.username}
                    {player.conceded && <span className="conceded-badge" title="Conceded"> · conceded</span>}
                    {gameStarted && (cumulativeTurnTime > 0 || currentTurnElapsed > 0) && (
                        <span className="player-turn-time" title="Total time on their turns">
                            {' '}{fmtTimer(cumulativeTurnTime + currentTurnElapsed)}
                        </span>
                    )}
                </span>
                {/* Always show the options button (not just touch) so desktop
                    users know they can access player actions without needing
                    to discover right-click. */}
                {!spectating && (
                    <button
                        className="player-options-btn"
                        title="Player options (right-click header also works)"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            onPlayerContextMenu?.({
                                preventDefault: () => {},
                                clientX: rect.left,
                                clientY: rect.bottom + 4,
                            });
                        }}
                    ><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>
                )}

                <div className="life-counter">
                    {!spectating && <button onClick={() => adjustLife(-1)}>-</button>}
                    {editingLife ? (
                        <input
                            type="text"
                            inputMode="numeric"
                            value={lifeInput}
                            onChange={e => setLifeInput(e.target.value)}
                            onBlur={handleLifeSubmit}
                            onKeyDown={e => e.key === 'Enter' && handleLifeSubmit()}
                            autoFocus
                            className="life-input"
                            placeholder="# or ∞"
                            title="Enter a number or ∞/inf for infinite"
                        />
                    ) : (
                        <span className="life-value" onClick={handleLifeClick}>{fmtNum(player.life)}</span>
                    )}
                    {!spectating && <button onClick={() => adjustLife(1)}>+</button>}
                </div>

                {/* Commander damage next to HP (commander formats only) */}
                {hasCommanderZone && cmdDmgEntries.length > 0 && (
                    <div
                        className="commander-damage-inline"
                        onClick={(e) => e.stopPropagation()}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    >
                        {cmdDmgEntries.filter(([, v]) => v > 0).map(([fromId, dmg]) => {
                            const from = allPlayers.find(p => p.userId === fromId);
                            return (
                                <span key={fromId} className={`cmd-dmg-badge ${dmg >= 21 ? 'lethal' : ''}`} title={`Commander damage from ${from?.username}`}>
                                    {from?.username || '?'}: {fmtNum(dmg)}/21
                                </span>
                            );
                        })}
                    </div>
                )}

                {/* Infect / poison next to HP — hidden when 0 so the header
                    stays clean. Use the right-click menu's "Infect..." entry
                    or Proliferate to start a poison count. Once above 0 it
                    responds to L-click +1 / R-click −1 / middle-click clear /
                    Shift-click to set. */}
                {totalInfect > 0 && (
                    <div
                        className="infect-inline"
                        onClick={(e) => e.stopPropagation()}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    >
                        <span
                            className={`infect-total ${lethalInfect ? 'lethal' : ''}`}
                            title={(spectating || !isOwner)
                                ? `Poison counters (${totalInfect}/10)`
                                : "Poison · L-click +1 · R-click −1 · middle-click clear · shift-click to set"}
                            onClick={(spectating || !isOwner) ? undefined : (e) => {
                                e.stopPropagation();
                                if (e.shiftKey) {
                                    dialog.prompt('Set poison counters:', String(totalInfect), {
                                        title: 'Set poison', inputType: 'number',
                                    }).then(v => {
                                        if (v === null || v === '') return;
                                        const n = parseInt(v, 10);
                                        if (!isNaN(n)) socket.emit('setInfect', { toPlayerId: player.userId, amount: Math.max(0, n) });
                                    });
                                } else {
                                    socket.emit('setInfect', { toPlayerId: player.userId, amount: totalInfect + 1 });
                                }
                            }}
                            onContextMenu={(spectating || !isOwner) ? (e) => { e.preventDefault(); e.stopPropagation(); } : (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                socket.emit('setInfect', { toPlayerId: player.userId, amount: Math.max(0, totalInfect - 1) });
                            }}
                            onMouseDown={(spectating || !isOwner) ? undefined : (e) => {
                                if (e.button === 1) { e.preventDefault(); e.stopPropagation(); socket.emit('setInfect', { toPlayerId: player.userId, amount: 0 }); }
                            }}
                        >
                            ☣ {fmtNum(totalInfect)}/10
                        </span>
                    </div>
                )}

                <div className="player-counters" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
                    {Object.entries(player.counters || {}).map(([name, val]) => (
                        <span
                            key={name}
                            className="player-counter-badge"
                            title={`${name} · click +1 · right-click -1 · middle-click remove entirely`}
                            onClick={spectating ? undefined : (e) => { e.stopPropagation(); socket.emit('setPlayerCounter', { targetPlayerId: player.userId, counter: name, value: isInfinite(val) ? INFINITE : val + 1 }); }}
                            onContextMenu={spectating ? (e) => { e.preventDefault(); e.stopPropagation(); } : (e) => { e.preventDefault(); e.stopPropagation(); socket.emit('setPlayerCounter', { targetPlayerId: player.userId, counter: name, value: isInfinite(val) ? INFINITE : Math.max(0, val - 1) }); }}
                            onMouseDown={spectating ? undefined : (e) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); socket.emit('removePlayerCounter', { targetPlayerId: player.userId, counter: name }); } }}
                        >
                            {name}: {fmtNum(val)}
                            {!spectating && (
                                <button
                                    className="player-counter-remove"
                                    title="Remove counter entirely"
                                    onClick={(e) => { e.stopPropagation(); socket.emit('removePlayerCounter', { targetPlayerId: player.userId, counter: name }); }}
                                >×</button>
                            )}
                        </span>
                    ))}
                </div>


                <div className="player-designations">
                    {player.designations?.monarch && <span className="designation-badge monarch" title="Monarch">Monarch</span>}
                    {player.designations?.initiative && <span className="designation-badge initiative" title="Initiative">Initiative</span>}
                    {player.designations?.citysBlessing && <span className="designation-badge blessing" title="City's Blessing">Blessing</span>}
                    {player.designations?.dayNight && <span className="designation-badge daynight" title="Day/Night">{player.designations.dayNight}</span>}
                </div>

                {/* Mana pool — small inline widget. Hidden when empty for opponents,
                    always shown (with the clear button hidden) for owner. */}
                <ManaPoolWidget pool={player.manaPool} isOwner={isOwner} playerId={player.userId} spectating={spectating} />
            </div>

            {/* Battlefield split into card-type rows; lands sit beside command zone */}
            {(() => {
                const bf = player.zones.battlefield || [];
                const categorize = (card) => {
                    if (card.bfRow) return card.bfRow;
                    const t = (card.typeLine || '').toLowerCase();
                    if (t.includes('creature')) return 'creatures';
                    if (t.includes('land')) return 'lands';
                    if (t.includes('planeswalker')) return 'creatures';
                    if (t.includes('artifact') || t.includes('enchantment') || t.includes('battle') || t.includes('kindred')) return 'artifacts';
                    // Instant / sorcery / anything else — still goes to artifacts
                    // row to avoid a lonely "other" row with one card in it.
                    return 'artifacts';
                };
                const groups = { creatures: [], artifacts: [], lands: [], other: [] };
                for (const c of bf) groups[categorize(c)].push(c);

                const renderCards = (cards, dragZone = 'battlefield') => cards.map(card => {
                    const isSelected = selectedIds?.has(card.instanceId);
                    return (
                        <div key={card.instanceId} className={`card-wrapper ${isSelected ? 'selected' : ''}`}
                            onMouseDown={(e) => handleCardMouseDown(e, card)}
                            onMouseEnter={(e) => handleCardMouseEnter(e, card)}
                            onTouchStart={(e) => onTouchStartCard(e, card, dragZone)}
                            onTouchMove={onTouchMoveCard}
                            onTouchEnd={onTouchEndCard}>
                            <Card
                                card={card}
                                onClick={(e) => handleCardClick(e, card)}
                                onContextMenu={(e) => { if (touchDragRef.current) { e.preventDefault(); e.stopPropagation(); return; } handleCardContext(e, card, dragZone); }}
                                draggable={isOwner && !touchMode}
                                onDragStart={(e) => handleDragStart(e, card, dragZone)}
                                attachedToName={attachedToName[card.instanceId]}
                                attachments={attachmentsOn[card.instanceId]}
                            />
                        </div>
                    );
                });

                const renderRow = (key, label, cards, extraClass = '') => {
                    const isCollapsed = collapsedRows.has(key);
                    return (
                        <BattlefieldRow
                            key={key}
                            extraClass={extraClass}
                            isCollapsed={isCollapsed}
                            onToggle={() => toggleRow(key)}
                            label={label}
                            cards={cards}
                            renderCards={renderCards}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, 'battlefield')}
                            playerId={player.userId}
                        />
                    );
                };

                return (
                    <>
                        <div className="bf-grid">
                            {/* Top row: creatures + artifacts (+ other if any) */}
                            <div className="bf-mid-row">
                                {renderRow('creatures', 'Creatures', groups.creatures, 'battlefield-creatures')}
                                {renderRow('artifacts', 'Artifacts/Enchant.', groups.artifacts, 'battlefield-artifacts')}
                                {groups.other.length > 0 && renderRow('other', 'Other', groups.other, 'battlefield-other')}
                            </div>

                            {/* Lands — full-width, horizontal-scroll row (same shape as Hand) */}
                            <LandsRow
                                cards={groups.lands}
                                renderCards={renderCards}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, 'battlefield')}
                                isCollapsed={collapsedRows.has('lands')}
                                onToggle={() => toggleRow('lands')}
                                playerId={player.userId}
                            />
                        </div>

                        {/* Command zone + Hand — command zone sits to the LEFT of the hand
                            so it reads as "my tracked pile beside the cards I'm holding".
                            The command cell collapses to a slim vertical label that takes
                            almost no horizontal space (useful when the user isn't actively
                            interacting with their commander). */}
                        <div className="hand-row">
                            {hasCommanderZone && (
                                <CommandZoneCell
                                    player={player}
                                    renderCards={renderCards}
                                    onDragOver={handleDragOver}
                                    onDrop={(e) => handleDrop(e, 'commandZone')}
                                    isCollapsed={collapsedRows.has('commandZone')}
                                    onToggle={() => toggleRow('commandZone')}
                                    playerId={player.userId}
                                />
                            )}
                            <HandZone
                                player={player}
                                isOwner={isOwner}
                                spectating={spectating}
                                renderZoneCards={renderZoneCards}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, 'hand')}
                                playerId={player.userId}
                            />
                        </div>
                    </>
                );
            })()}

            {/* Side zones */}
            <div className="side-zones">
                <div className="zone graveyard-zone" data-drop-zone="graveyard" data-drop-player={player.userId}
                    onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'graveyard')}
                    onClick={() => setExpandedZone(expandedZone === 'graveyard' ? null : 'graveyard')}>
                    <div className="zone-label">Graveyard ({player.zones.graveyard?.length || 0})</div>
                    {expandedZone === 'graveyard' && (
                        <div className="zone-cards expanded">{renderZoneCards(player.zones.graveyard, 'graveyard')}</div>
                    )}
                </div>
                <div className="zone exile-zone" data-drop-zone="exile" data-drop-player={player.userId}
                    onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'exile')}
                    onClick={() => setExpandedZone(expandedZone === 'exile' ? null : 'exile')}>
                    <div className="zone-label">Exile ({player.zones.exile?.length || 0})</div>
                    {expandedZone === 'exile' && (
                        <div className="zone-cards expanded">{renderZoneCards(player.zones.exile, 'exile')}</div>
                    )}
                </div>

                {/* Conditional new zones — only render when they have content,
                    so existing 4-zone (Graveyard / Exile / Library) layouts are
                    visually unchanged for users who don't use these. */}
                {(player.zones.foretellCount > 0 || (player.zones.foretell && player.zones.foretell.length > 0)) && (
                    <div className="zone foretell-zone" data-drop-zone="foretell" data-drop-player={player.userId}
                        onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'foretell')}
                        onClick={() => setExpandedZone(expandedZone === 'foretell' ? null : 'foretell')}>
                        <div className="zone-label">Foretell ({player.zones.foretellCount ?? player.zones.foretell?.length ?? 0})</div>
                        {expandedZone === 'foretell' && isOwner && (
                            <div className="zone-cards expanded">{renderZoneCards(player.zones.foretell, 'foretell')}</div>
                        )}
                    </div>
                )}
                {(player.zones.sideboardCount > 0 || (player.zones.sideboard && player.zones.sideboard.length > 0)) && (
                    <div className="zone sideboard-zone" data-drop-zone="sideboard" data-drop-player={player.userId}
                        onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'sideboard')}
                        onClick={() => setExpandedZone(expandedZone === 'sideboard' ? null : 'sideboard')}>
                        <div className="zone-label">Sideboard ({player.zones.sideboardCount ?? player.zones.sideboard?.length ?? 0})</div>
                        {expandedZone === 'sideboard' && isOwner && (
                            <div className="zone-cards expanded">{renderZoneCards(player.zones.sideboard, 'sideboard')}</div>
                        )}
                    </div>
                )}
                {(player.zones.companionsCount > 0 || (player.zones.companions && player.zones.companions.length > 0)) && (
                    <div className="zone companions-zone" data-drop-zone="companions" data-drop-player={player.userId}
                        onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'companions')}
                        onClick={() => setExpandedZone(expandedZone === 'companions' ? null : 'companions')}>
                        <div className="zone-label">Wishboard ({player.zones.companionsCount ?? player.zones.companions?.length ?? 0})</div>
                        {expandedZone === 'companions' && isOwner && (
                            <div className="zone-cards expanded">{renderZoneCards(player.zones.companions, 'companions')}</div>
                        )}
                    </div>
                )}
                {Array.isArray(player.zones.emblems) && player.zones.emblems.length > 0 && (
                    <div className="zone emblem-zone"
                        onClick={() => setExpandedZone(expandedZone === 'emblems' ? null : 'emblems')}>
                        <div className="zone-label">Emblems ({player.zones.emblems.length})</div>
                        {expandedZone === 'emblems' && (
                            <div className="zone-cards expanded emblem-list">
                                {player.zones.emblems.map(em => (
                                    <div key={em.id} className="emblem-entry" title={em.oracleText}>
                                        <span className="emblem-name">{em.name}</span>
                                        {isOwner && (
                                            <button
                                                className="emblem-remove"
                                                onClick={(e) => { e.stopPropagation(); socket.emit('removeEmblem', { targetPlayerId: player.userId, emblemId: em.id }); }}
                                            >×</button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div className="zone library-zone" data-drop-zone="library" data-drop-player={player.userId}
                    onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'library')}>
                    <div className="zone-label"
                        onClick={() => isOwner ? onViewLibrary?.() : null}
                        title={isOwner ? 'View library (alphabetical)' : ''}>
                        Library ({player.zones.libraryCount ?? player.zones.library?.length ?? 0})
                    </div>
                    {isOwner && (
                        <div className="library-actions">
                            <button
                                onClick={() => socket.emit('drawCards', { count: 1 })}
                                className={needsDraw ? 'turn-nudge' : ''}
                                title={needsDraw ? "You haven't drawn this turn" : 'Draw a card (shift-click or right-click to draw face-down)'}
                                onContextMenu={(e) => { e.preventDefault(); socket.emit('drawCards', { count: 1, faceDown: true }); }}
                                onMouseDown={(e) => {
                                    if (e.shiftKey && e.button === 0) {
                                        e.preventDefault();
                                        socket.emit('drawCards', { count: 1, faceDown: true });
                                    }
                                }}
                            >Draw</button>
                            <button
                                onClick={() => socket.emit('drawCards', { count: 1, faceDown: true })}
                                title="Draw one card face-down (flip it up later when ready)"
                                data-sfx="draw"
                            >Draw ↓</button>
                            <button onClick={() => socket.emit('shuffleLibrary')}>Shuffle</button>
                            <button onClick={() => socket.emit('mill', { count: 1 })}>Mill 1</button>
                            <button onClick={() => onScry?.()}>Scry</button>
                            <button onClick={() => onTutor?.()}>Tutor</button>
                        </div>
                    )}
                </div>
            </div>

            {contextMenu && <ContextMenu {...contextMenu} onClose={() => setContextMenu(null)} />}

            {noteEditor && (
                <NoteEditor
                    instanceId={noteEditor.instanceId}
                    onClose={() => setNoteEditor(null)}
                />
            )}

            {counterModal && (
                <CounterModal
                    card={counterModal.card}
                    onApply={(name, val, mode, endOfTurn) => {
                        socket.emit('setCardCounter', { instanceId: counterModal.instanceId, counter: name, value: val, mode, endOfTurn });
                        setCounterModal(null);
                    }}
                    onClose={() => setCounterModal(null)}
                />
            )}
        </div>
    );
}

function BattlefieldRow({ extraClass, isCollapsed, onToggle, label, cards, renderCards, onDragOver, onDrop, playerId }) {
    const ref = useHorizontalWheel();
    // All cells share the row equally (flex: 1 1 0) with the min-width in
    // CSS acting as the floor. This avoids the old proportional-to-count
    // grow making one cell hog space while others stay cramped. If content
    // exceeds the cell's height it scrolls vertically (already set on
    // .battlefield-cards).
    return (
        <div className={`zone battlefield bf-cell ${extraClass} ${isCollapsed ? 'collapsed' : ''}`}
            data-drop-zone="battlefield" data-drop-player={playerId}
            onDragOver={onDragOver}
            onDrop={onDrop}
            style={{ flex: isCollapsed ? '0 0 auto' : '1 1 0' }}>
            <div className="bf-row-label">
                <span className="bf-row-toggle" onClick={onToggle}>
                    <span className="bf-collapse-icon"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={isCollapsed ? {transform:'rotate(-90deg)'} : {}}><polyline points="6 9 12 15 18 9"/></svg></span>
                    {label} ({cards.length})
                </span>
            </div>
            {!isCollapsed && (
                <div ref={ref} className="zone-cards battlefield-cards">
                    {cards.length === 0 ? <div className="zone-empty">—</div> : renderCards(cards)}
                </div>
            )}
        </div>
    );
}

function CommandZoneCell({ player, renderCards, onDragOver, onDrop, isCollapsed, onToggle, playerId }) {
    const ref = useHorizontalWheel();
    // When collapsed the cell shrinks to just the vertical label so the
    // hand can take the full remaining width. When expanded the cell
    // sizes to fit about one card plus the label.
    return (
        <div className={`zone command-zone cmd-beside-hand ${isCollapsed ? 'collapsed' : ''}`}
            data-drop-zone="commandZone" data-drop-player={playerId}
            onDragOver={onDragOver}
            onDrop={onDrop}>
            <div className={`bf-row-label cmd-zone-label ${isCollapsed ? 'cmd-zone-label-vertical' : ''}`}>
                <span className="bf-row-toggle" onClick={onToggle}>
                    <span className="bf-collapse-icon"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={isCollapsed ? {transform:'rotate(-90deg)'} : {}}><polyline points="6 9 12 15 18 9"/></svg></span>
                    Command ({player.zones.commandZone?.length || 0})
                </span>
                {!isCollapsed && (player.commanderDeaths > 0 || player.commanderTax > 0) && (
                    <div className="cmd-zone-meta">
                        {player.commanderDeaths > 0 && <span className="death-counter">Deaths: {player.commanderDeaths}</span>}
                        {player.commanderTax > 0 && <span className="tax-counter">Tax: {player.commanderTax}</span>}
                    </div>
                )}
            </div>
            {!isCollapsed && (
                <div ref={ref} className="zone-cards battlefield-cards cmd-cards-row">
                    {(player.zones.commandZone?.length || 0) === 0
                        ? <div className="zone-empty">—</div>
                        : renderCards(player.zones.commandZone, 'commandZone')}
                </div>
            )}
        </div>
    );
}

// Lands row — modeled after HandZone: fixed-height, full-width, scrolls
// horizontally. Replaces the old grid cell so lands don't fight for
// horizontal space with the command zone / artifacts row.
function LandsRow({ cards, renderCards, onDragOver, onDrop, isCollapsed, onToggle, playerId }) {
    const ref = useHorizontalWheel();
    return (
        <div className={`zone battlefield battlefield-lands lands-row ${isCollapsed ? 'collapsed' : ''}`}
            data-drop-zone="battlefield" data-drop-player={playerId}
            onDragOver={onDragOver}
            onDrop={onDrop}>
            <div className="bf-row-label">
                <span className="bf-row-toggle" onClick={onToggle}>
                    <span className="bf-collapse-icon"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={isCollapsed ? {transform:'rotate(-90deg)'} : {}}><polyline points="6 9 12 15 18 9"/></svg></span>
                    Lands ({cards.length})
                </span>
            </div>
            {!isCollapsed && (
                <div ref={ref} className="zone-cards lands-cards">
                    {cards.length === 0 ? <div className="zone-empty">—</div> : renderCards(cards)}
                </div>
            )}
        </div>
    );
}

function HandZone({ player, isOwner, spectating, renderZoneCards, onDragOver, onDrop, playerId }) {
    const ref = useHorizontalWheel();
    // Spectators see every player's hand, not just their own (which they don't have).
    const showHand = isOwner || spectating;
    return (
        <div className="zone hand-zone" data-drop-zone="hand" data-drop-player={playerId} onDragOver={onDragOver} onDrop={onDrop}>
            <div className="zone-label">
                Hand ({player.zones.handCount ?? player.zones.hand?.length ?? 0})
            </div>
            {showHand && (
                <div ref={ref} className="zone-cards hand-cards">{renderZoneCards(player.zones.hand, 'hand')}</div>
            )}
        </div>
    );
}

