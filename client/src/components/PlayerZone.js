import React, { useState } from 'react';
import socket from '../socket';
import Card from './Card';
import ContextMenu from './ContextMenu';
import NoteEditor from './NoteEditor';
import CounterModal from './CounterModal';
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

export default function PlayerZone({ player, isOwner, userId, allPlayers, onMaximizeCard, onScry, onTutor, onPlayerContextMenu, onViewLibrary, selectedIds, onToggleSelect, onClearSelection, compact, isCurrentTurn, touchMode, spectating, gameStarted, onCloneCard, onShowCardFieldEditor, onTakeControl, onCastFromZone, onForetellCard, onCastForetold, cumulativeTurnTime, currentTurnElapsed, pendingAction, onStartPendingAction, onResolvePendingCard, onResolvePendingPlayer, optimisticUpdateCard, optimisticUpdatePlayer }) {
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
        // Touch devices: tap toggles selection (the sticky toolbar takes over).
        // Desktop behavior is unchanged.
        if (touchMode) {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect?.(card.instanceId);
            return;
        }
        // Normal desktop click — clear selection and maximize
        if (selectedIds && selectedIds.size > 0) onClearSelection?.();
        onMaximizeCard(card);
    };

    const handleCardContext = (e, card, zone) => {
        e.preventDefault();
        e.stopPropagation();
        // Spectators don't get a card context menu — everything in it mutates
        // state that the server would reject anyway.
        if (spectating) return;
        // On touch devices the right-click context menu is unreachable; the
        // sticky bottom toolbar is the equivalent. Suppress the menu so a
        // long-press doesn't open something with no good way to dismiss it.
        if (touchMode) return;
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
            ...stateActionItems,
            ...combatItems,
            ...castFromZoneItems,
            { divider: true },
            ...zones.filter(z => z !== zone && z !== 'library').map(z => ({
                label: `Move to ${z === 'commandZone' ? 'Command Zone' : z}`,
                onClick: () => socket.emit('moveCard', { instanceId: card.instanceId, fromZone: zone, toZone: z }),
            })),
            ...(zone !== 'library' ? [
                { label: 'To top of library', onClick: () => socket.emit('moveCard', { instanceId: card.instanceId, fromZone: zone, toZone: 'library', libraryPosition: 'top' }) },
                { label: 'To bottom of library', onClick: () => socket.emit('moveCard', { instanceId: card.instanceId, fromZone: zone, toZone: 'library' }) },
            ] : []),
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
            // Glow any land in your own hand on your own turn until you
            // actually play one — the nudge clears as soon as landsPlayedThisTurn
            // becomes nonzero (which updates needsLand above).
            const pendingLand = zone === 'hand' && needsLand && isLandCard(card);
            return (
                <div key={card.instanceId} className={`card-wrapper ${isSelected ? 'selected' : ''} ${pendingLand ? 'turn-nudge-land' : ''}`}
                    onMouseDown={(e) => handleCardMouseDown(e, card)}
                    onMouseEnter={(e) => handleCardMouseEnter(e, card)}>
                    <Card
                        card={card}
                        onClick={(e) => handleCardClick(e, card)}
                        onContextMenu={(e) => handleCardContext(e, card, zone)}
                        draggable={isOwner}
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
    const lethalCmdDmg = cmdDmgEntries.some(([, dmg]) => dmg >= 21);
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
                    >⋮</button>
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

                {/* Commander damage next to HP, full names */}
                {cmdDmgEntries.length > 0 && (
                    <div className="commander-damage-inline">
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

                {/* Infect / poison next to HP */}
                {totalInfect > 0 && (
                    <div className="infect-inline">
                        <span className={`infect-total ${lethalInfect ? 'lethal' : ''}`} title="Poison counters">
                            ☣ {fmtNum(totalInfect)}/10
                        </span>
                    </div>
                )}

                <div className="player-counters">
                    {Object.entries(player.counters || {}).filter(([, v]) => v > 0).map(([name, val]) => (
                        <span key={name} className="player-counter-badge" title={`${name} · click +1 · right-click -1 · middle-click remove`}
                            onClick={spectating ? undefined : () => socket.emit('setPlayerCounter', { targetPlayerId: player.userId, counter: name, value: isInfinite(val) ? INFINITE : val + 1 })}
                            onContextMenu={spectating ? (e) => e.preventDefault() : (e) => { e.preventDefault(); socket.emit('setPlayerCounter', { targetPlayerId: player.userId, counter: name, value: isInfinite(val) ? INFINITE : Math.max(0, val - 1) }); }}
                            onMouseDown={spectating ? undefined : (e) => { if (e.button === 1) { e.preventDefault(); socket.emit('setPlayerCounter', { targetPlayerId: player.userId, counter: name, value: 0 }); } }}>
                            {name}: {fmtNum(val)}
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
                            onMouseEnter={(e) => handleCardMouseEnter(e, card)}>
                            <Card
                                card={card}
                                onClick={(e) => handleCardClick(e, card)}
                                onContextMenu={(e) => handleCardContext(e, card, dragZone)}
                                draggable={isOwner}
                                onDragStart={(e) => handleDragStart(e, card, dragZone)}
                                attachedToName={attachedToName[card.instanceId]}
                                attachments={attachmentsOn[card.instanceId]}
                            />
                        </div>
                    );
                });

                const dynamicGrow = (cards) => Math.max(1, Math.min(cards.length, 12));

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
                            grow={dynamicGrow(cards)}
                        />
                    );
                };

                return (
                    <div className="bf-grid">
                        {/* Top row: command zone + lands */}
                        <div className="bf-top-row">
                            <CommandZoneCell
                                player={player}
                                renderCards={renderCards}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, 'commandZone')}
                                grow={dynamicGrow(player.zones.commandZone || [])}
                            />

                            {renderRow('lands', 'Lands', groups.lands, 'battlefield-lands')}
                        </div>

                        {/* Middle: creatures + artifacts (+ other if any) side-by-side, growing with content */}
                        <div className="bf-mid-row">
                            {renderRow('creatures', 'Creatures', groups.creatures, 'battlefield-creatures')}
                            {renderRow('artifacts', 'Artifacts/Enchant.', groups.artifacts, 'battlefield-artifacts')}
                            {groups.other.length > 0 && renderRow('other', 'Other', groups.other, 'battlefield-other')}
                        </div>
                    </div>
                );
            })()}

            {/* Hand */}
            <HandZone
                player={player}
                isOwner={isOwner}
                spectating={spectating}
                renderZoneCards={renderZoneCards}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, 'hand')}
            />

            {/* Side zones */}
            <div className="side-zones">
                <div className="zone graveyard-zone"
                    onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'graveyard')}
                    onClick={() => setExpandedZone(expandedZone === 'graveyard' ? null : 'graveyard')}>
                    <div className="zone-label">Graveyard ({player.zones.graveyard?.length || 0})</div>
                    {expandedZone === 'graveyard' && (
                        <div className="zone-cards expanded">{renderZoneCards(player.zones.graveyard, 'graveyard')}</div>
                    )}
                </div>
                <div className="zone exile-zone"
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
                    <div className="zone foretell-zone"
                        onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'foretell')}
                        onClick={() => setExpandedZone(expandedZone === 'foretell' ? null : 'foretell')}>
                        <div className="zone-label">Foretell ({player.zones.foretellCount ?? player.zones.foretell?.length ?? 0})</div>
                        {expandedZone === 'foretell' && isOwner && (
                            <div className="zone-cards expanded">{renderZoneCards(player.zones.foretell, 'foretell')}</div>
                        )}
                    </div>
                )}
                {(player.zones.sideboardCount > 0 || (player.zones.sideboard && player.zones.sideboard.length > 0)) && (
                    <div className="zone sideboard-zone"
                        onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'sideboard')}
                        onClick={() => setExpandedZone(expandedZone === 'sideboard' ? null : 'sideboard')}>
                        <div className="zone-label">Sideboard ({player.zones.sideboardCount ?? player.zones.sideboard?.length ?? 0})</div>
                        {expandedZone === 'sideboard' && isOwner && (
                            <div className="zone-cards expanded">{renderZoneCards(player.zones.sideboard, 'sideboard')}</div>
                        )}
                    </div>
                )}
                {(player.zones.companionsCount > 0 || (player.zones.companions && player.zones.companions.length > 0)) && (
                    <div className="zone companions-zone"
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

                <div className="zone library-zone"
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
                                title={needsDraw ? "You haven't drawn this turn" : 'Draw a card'}
                            >Draw</button>
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
                    onAdd={(name, val) => {
                        socket.emit('setCardCounter', { instanceId: counterModal.instanceId, counter: name, value: val });
                        setCounterModal(null);
                    }}
                    onClose={() => setCounterModal(null)}
                />
            )}
        </div>
    );
}

function BattlefieldRow({ extraClass, isCollapsed, onToggle, label, cards, renderCards, onDragOver, onDrop, grow }) {
    const ref = useHorizontalWheel();
    return (
        <div className={`zone battlefield bf-cell ${extraClass} ${isCollapsed ? 'collapsed' : ''}`}
            onDragOver={onDragOver}
            onDrop={onDrop}
            style={{ flexGrow: isCollapsed ? 0 : grow, flexBasis: isCollapsed ? 'auto' : 0 }}>
            <div className="bf-row-label">
                <span className="bf-row-toggle" onClick={onToggle}>
                    <span className="bf-collapse-icon">{isCollapsed ? '▶' : '▼'}</span>
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

function CommandZoneCell({ player, renderCards, onDragOver, onDrop, grow }) {
    const ref = useHorizontalWheel();
    return (
        <div className="zone command-zone bf-cell"
            onDragOver={onDragOver}
            onDrop={onDrop}
            style={{ flexGrow: grow }}>
            <div className="zone-label">
                Command ({player.zones.commandZone?.length || 0})
                {player.commanderDeaths > 0 && <span className="death-counter"> · Deaths: {player.commanderDeaths}</span>}
                {player.commanderTax > 0 && <span className="tax-counter"> · Tax: {player.commanderTax}</span>}
            </div>
            <div ref={ref} className="zone-cards battlefield-cards">
                {(player.zones.commandZone?.length || 0) === 0
                    ? <div className="zone-empty">—</div>
                    : renderCards(player.zones.commandZone, 'commandZone')}
            </div>
        </div>
    );
}

function HandZone({ player, isOwner, spectating, renderZoneCards, onDragOver, onDrop }) {
    const ref = useHorizontalWheel();
    // Spectators see every player's hand, not just their own (which they don't have).
    const showHand = isOwner || spectating;
    return (
        <div className="zone hand-zone" onDragOver={onDragOver} onDrop={onDrop}>
            <div className="zone-label">
                Hand ({player.zones.handCount ?? player.zones.hand?.length ?? 0})
            </div>
            {showHand && (
                <div ref={ref} className="zone-cards hand-cards">{renderZoneCards(player.zones.hand, 'hand')}</div>
            )}
        </div>
    );
}

