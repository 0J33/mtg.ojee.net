import React, { useState } from 'react';
import socket from '../socket';
import Card from './Card';
import ContextMenu from './ContextMenu';

export default function PlayerZone({ player, isOwner, userId, allPlayers, onMaximizeCard, onScry }) {
    const [contextMenu, setContextMenu] = useState(null);
    const [expandedZone, setExpandedZone] = useState(null);
    const [editingLife, setEditingLife] = useState(false);
    const [lifeInput, setLifeInput] = useState('');
    const [counterModal, setCounterModal] = useState(null);

    const handleCardContext = (e, card, zone) => {
        e.preventDefault();
        e.stopPropagation();
        const zones = ['hand', 'battlefield', 'graveyard', 'exile', 'commandZone'];
        const items = [
            { label: `View: ${card.name || 'Face-down'}`, onClick: () => onMaximizeCard(card) },
            { label: card.tapped ? 'Untap' : 'Tap', onClick: () => socket.emit('tapCard', { instanceId: card.instanceId }) },
            { divider: true },
            ...zones.filter(z => z !== zone).map(z => ({
                label: `Move to ${z === 'commandZone' ? 'Command Zone' : z}`,
                onClick: () => socket.emit('moveCard', { instanceId: card.instanceId, fromZone: zone, toZone: z }),
            })),
            { divider: true },
            { label: card.flipped ? 'Flip to front' : 'Flip to back', onClick: () => socket.emit('flipCard', { instanceId: card.instanceId }) },
            { label: card.faceDown ? 'Turn face-up' : 'Turn face-down', onClick: () => socket.emit('toggleFaceDown', { instanceId: card.instanceId }) },
            { divider: true },
            { label: 'Reveal to all', onClick: () => socket.emit('revealCard', { instanceId: card.instanceId, targetPlayerIds: 'all' }) },
            ...allPlayers.filter(p => p.userId !== userId).map(p => ({
                label: `Reveal to ${p.username}`,
                onClick: () => socket.emit('revealCard', { instanceId: card.instanceId, targetPlayerIds: [p.userId] }),
            })),
            { divider: true },
            { label: 'Add counter...', onClick: () => setCounterModal({ instanceId: card.instanceId, card }) },
        ];
        setContextMenu({ x: e.clientX, y: e.clientY, items });
    };

    const handleLifeClick = () => {
        setEditingLife(true);
        setLifeInput(player.life.toString());
    };

    const handleLifeSubmit = () => {
        const val = parseInt(lifeInput);
        if (!isNaN(val)) socket.emit('setLife', { targetPlayerId: player.userId, life: val });
        setEditingLife(false);
    };

    const adjustLife = (amount) => socket.emit('adjustLife', { targetPlayerId: player.userId, amount });

    const renderZoneCards = (cards, zone) => {
        if (!cards || cards.length === 0) return <div className="zone-empty">Empty</div>;
        return cards.map(card => {
            const isHidden = card.hidden;
            if (isHidden) return <div key={Math.random()} className="card card-hidden" />;
            return (
                <Card
                    key={card.instanceId}
                    card={card}
                    onClick={() => onMaximizeCard(card)}
                    onContextMenu={(e) => handleCardContext(e, card, zone)}
                />
            );
        });
    };

    const cmdDmgEntries = Object.entries(player.commanderDamageFrom || {});

    return (
        <div className="player-zone" style={player.background ? { backgroundImage: `url(${player.background})` } : {}}>
            <div className="player-header">
                <span className={`player-name ${player.connected ? 'online' : 'offline'}`}>
                    {player.username}
                    {allPlayers[allPlayers.findIndex(p => p.userId === player.userId)] && (
                        <span className="turn-indicator">
                            {allPlayers.findIndex(p => p.userId === player.userId) === 0 ? '' : ''}
                        </span>
                    )}
                </span>

                <div className="life-counter">
                    <button onClick={() => adjustLife(-1)}>-</button>
                    {editingLife ? (
                        <input
                            type="number"
                            value={lifeInput}
                            onChange={e => setLifeInput(e.target.value)}
                            onBlur={handleLifeSubmit}
                            onKeyDown={e => e.key === 'Enter' && handleLifeSubmit()}
                            autoFocus
                            className="life-input"
                        />
                    ) : (
                        <span className="life-value" onClick={handleLifeClick}>{player.life}</span>
                    )}
                    <button onClick={() => adjustLife(1)}>+</button>
                </div>

                <div className="player-counters">
                    {Object.entries(player.counters || {}).filter(([, v]) => v > 0).map(([name, val]) => (
                        <span key={name} className="player-counter-badge" title={name}
                            onClick={() => socket.emit('setPlayerCounter', { targetPlayerId: player.userId, counter: name, value: val + 1 })}
                            onContextMenu={(e) => { e.preventDefault(); socket.emit('setPlayerCounter', { targetPlayerId: player.userId, counter: name, value: Math.max(0, val - 1) }); }}>
                            {name}: {val}
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

            {/* Command Zone */}
            <div className="zone command-zone" onClick={() => setExpandedZone(expandedZone === 'commandZone' ? null : 'commandZone')}>
                <div className="zone-label">
                    Command Zone ({player.zones.commandZone?.length || 0})
                    {player.commanderDeaths > 0 && <span className="death-counter" title="Commander deaths"> | Deaths: {player.commanderDeaths}</span>}
                    {player.commanderTax > 0 && <span className="tax-counter" title="Commander tax"> | Tax: {player.commanderTax}</span>}
                </div>
                {(expandedZone === 'commandZone' || (player.zones.commandZone?.length || 0) <= 3) && (
                    <div className="zone-cards">{renderZoneCards(player.zones.commandZone, 'commandZone')}</div>
                )}
            </div>

            {/* Battlefield */}
            <div className="zone battlefield">
                <div className="zone-cards battlefield-cards">
                    {renderZoneCards(player.zones.battlefield, 'battlefield')}
                </div>
            </div>

            {/* Hand */}
            <div className="zone hand-zone">
                <div className="zone-label">
                    Hand ({player.zones.handCount ?? player.zones.hand?.length ?? 0})
                </div>
                {isOwner && (
                    <div className="zone-cards hand-cards">{renderZoneCards(player.zones.hand, 'hand')}</div>
                )}
            </div>

            {/* Side zones */}
            <div className="side-zones">
                <div className="zone graveyard-zone" onClick={() => setExpandedZone(expandedZone === 'graveyard' ? null : 'graveyard')}>
                    <div className="zone-label">Graveyard ({player.zones.graveyard?.length || 0})</div>
                    {expandedZone === 'graveyard' && (
                        <div className="zone-cards expanded">{renderZoneCards(player.zones.graveyard, 'graveyard')}</div>
                    )}
                </div>
                <div className="zone exile-zone" onClick={() => setExpandedZone(expandedZone === 'exile' ? null : 'exile')}>
                    <div className="zone-label">Exile ({player.zones.exile?.length || 0})</div>
                    {expandedZone === 'exile' && (
                        <div className="zone-cards expanded">{renderZoneCards(player.zones.exile, 'exile')}</div>
                    )}
                </div>
                <div className="zone library-zone">
                    <div className="zone-label">Library ({player.zones.libraryCount ?? player.zones.library?.length ?? 0})</div>
                    {isOwner && (
                        <div className="library-actions">
                            <button onClick={() => socket.emit('drawCards', { count: 1 })}>Draw</button>
                            <button onClick={() => socket.emit('shuffleLibrary')}>Shuffle</button>
                            <button onClick={() => socket.emit('mill', { count: 1 })}>Mill 1</button>
                            <button onClick={() => onScry?.()}>Scry</button>
                        </div>
                    )}
                </div>
            </div>

            {/* Commander damage from others */}
            {cmdDmgEntries.length > 0 && (
                <div className="commander-damage-list">
                    {cmdDmgEntries.filter(([, v]) => v > 0).map(([fromId, dmg]) => {
                        const from = allPlayers.find(p => p.userId === fromId);
                        return (
                            <span key={fromId} className="cmd-dmg-badge" title={`Commander damage from ${from?.username}`}>
                                {from?.username?.slice(0, 3)}: {dmg}/21
                            </span>
                        );
                    })}
                </div>
            )}

            {contextMenu && <ContextMenu {...contextMenu} onClose={() => setContextMenu(null)} />}

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

function CounterModal({ card, onAdd, onClose }) {
    const [name, setName] = useState('+1/+1');
    const [value, setValue] = useState(1);
    const presets = ['+1/+1', '-1/-1', 'loyalty', 'charge', 'shield', 'lore', 'time'];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal counter-modal" onClick={e => e.stopPropagation()}>
                <h3>Add Counter to {card.name}</h3>
                <div className="counter-presets">
                    {presets.map(p => (
                        <button key={p} className={name === p ? 'active' : ''} onClick={() => setName(p)}>{p}</button>
                    ))}
                </div>
                <div className="counter-custom">
                    <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Counter name" />
                    <input type="number" value={value} onChange={e => setValue(parseInt(e.target.value) || 0)} min={0} />
                </div>
                <button onClick={() => onAdd(name, value)} className="primary-btn">Add</button>
            </div>
        </div>
    );
}
