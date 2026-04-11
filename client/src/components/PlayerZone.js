import React, { useState } from 'react';
import socket from '../socket';
import Card from './Card';
import ContextMenu from './ContextMenu';
import NoteEditor from './NoteEditor';
import CounterModal from './CounterModal';
import { useEscapeKey, useHorizontalWheel, fmtNum, parseGameValue, isInfinite, INFINITE } from '../utils';

export default function PlayerZone({ player, isOwner, userId, allPlayers, onMaximizeCard, onScry, onTutor, onPlayerContextMenu, onViewLibrary, selectedIds, onToggleSelect, onClearSelection, compact, isCurrentTurn, touchMode, spectating }) {
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

    const handleCardClick = (e, card) => {
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

        const items = [
            { label: `View: ${card.name || 'Face-down'}`, onClick: () => onMaximizeCard(card) },
            {
                label: card.tapped ? 'Untap' : 'Tap',
                onClick: () => socket.emit('tapCard', { instanceId: card.instanceId }),
            },
            ...bfRowItems,
            { divider: true },
            ...zones.filter(z => z !== zone).map(z => ({
                label: `Move to ${z === 'commandZone' ? 'Command Zone' : z}`,
                onClick: () => socket.emit('moveCard', { instanceId: card.instanceId, fromZone: zone, toZone: z }),
            })),
            { divider: true },
            // Unified "Flip" action — for double-faced cards, swap sides;
            // otherwise toggle face-down. Cards that are both DFC and need to
            // be face-down (morph shenanigans) can still be force-face-down via
            // the extra item below.
            (() => {
                const hasBack = !!card.backImageUri;
                if (hasBack) {
                    return {
                        label: card.flipped ? 'Flip to front' : 'Flip to back',
                        onClick: () => socket.emit('flipCard', { instanceId: card.instanceId }),
                    };
                }
                return {
                    label: card.faceDown ? 'Turn face-up' : 'Turn face-down',
                    onClick: () => socket.emit('toggleFaceDown', { instanceId: card.instanceId }),
                };
            })(),
            // Edge case: DFC card that also needs the generic face-down back
            ...(card.backImageUri ? [{
                label: card.faceDown ? 'Turn face-up' : 'Turn face-down',
                onClick: () => socket.emit('toggleFaceDown', { instanceId: card.instanceId }),
            }] : []),
            { divider: true },
            { label: 'Reveal to all', onClick: () => socket.emit('revealCard', { instanceId: card.instanceId, targetPlayerIds: 'all' }) },
            ...allPlayers.filter(p => p.userId !== userId).map(p => ({
                label: `Reveal to ${p.username}`,
                onClick: () => socket.emit('revealCard', { instanceId: card.instanceId, targetPlayerIds: [p.userId] }),
            })),
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
            return (
                <div key={card.instanceId} className={`card-wrapper ${isSelected ? 'selected' : ''}`}>
                    <Card
                        card={card}
                        onClick={(e) => handleCardClick(e, card)}
                        onContextMenu={(e) => handleCardContext(e, card, zone)}
                        draggable={isOwner}
                        onDragStart={(e) => handleDragStart(e, card, zone)}
                    />
                </div>
            );
        });
    };

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
            <div className="player-header" onContextMenu={spectating ? undefined : onPlayerContextMenu}>
                <span className={`player-name ${player.connected ? 'online' : 'offline'}`}>
                    {player.username}
                </span>
                {touchMode && !spectating && (
                    <button
                        className="player-options-btn"
                        title="Player options"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Synthesize a click event with coordinates so the
                            // context-menu opens anchored to this button.
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
                        <span key={name} className="player-counter-badge" title={name}
                            onClick={spectating ? undefined : () => socket.emit('setPlayerCounter', { targetPlayerId: player.userId, counter: name, value: isInfinite(val) ? INFINITE : val + 1 })}
                            onContextMenu={spectating ? (e) => e.preventDefault() : (e) => { e.preventDefault(); socket.emit('setPlayerCounter', { targetPlayerId: player.userId, counter: name, value: isInfinite(val) ? INFINITE : Math.max(0, val - 1) }); }}>
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
                    if (t.includes('artifact') || t.includes('enchantment')) return 'artifacts';
                    return 'other';
                };
                const groups = { creatures: [], artifacts: [], lands: [], other: [] };
                for (const c of bf) groups[categorize(c)].push(c);

                const renderCards = (cards, dragZone = 'battlefield') => cards.map(card => {
                    const isSelected = selectedIds?.has(card.instanceId);
                    return (
                        <div key={card.instanceId} className={`card-wrapper ${isSelected ? 'selected' : ''}`}>
                            <Card
                                card={card}
                                onClick={(e) => handleCardClick(e, card)}
                                onContextMenu={(e) => handleCardContext(e, card, dragZone)}
                                draggable={isOwner}
                                onDragStart={(e) => handleDragStart(e, card, dragZone)}
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
                <div className="zone library-zone"
                    onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'library')}>
                    <div className="zone-label"
                        onClick={() => isOwner ? onViewLibrary?.() : null}
                        title={isOwner ? 'View library (alphabetical)' : ''}>
                        Library ({player.zones.libraryCount ?? player.zones.library?.length ?? 0})
                    </div>
                    {isOwner && (
                        <div className="library-actions">
                            <button onClick={() => socket.emit('drawCards', { count: 1 })}>Draw</button>
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

