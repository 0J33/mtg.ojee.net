import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import socket from '../socket';

/**
 * Shared piles panel. Collapsible from a floating toggle button so it
 * doesn't take up board space by default. Any player can create, delete,
 * rename, shuffle, or move cards into any pile.
 *
 * Cards in piles are fully visible to everyone (like graveyard / exile).
 */
export default function PilesPanel({ piles, players, userId, onMaximizeCard, spectating }) {
    const [open, setOpen] = useState(false);
    const [expanded, setExpanded] = useState(new Set()); // expanded pile ids
    const [renameFor, setRenameFor] = useState(null);    // pileId
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [createName, setCreateName] = useState('');

    const totalCards = (piles || []).reduce((n, p) => n + (p.count || 0), 0);

    const togglePile = (id) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const createPile = () => {
        const name = createName.trim();
        socket.emit('createPile', { name });
        setCreateName('');
        setCreating(false);
    };

    const deletePile = (pileId) => {
        if (!window.confirm('Delete this pile? Cards will return to the creator\u2019s hand.')) return;
        socket.emit('deletePile', { pileId });
    };

    const renamePile = () => {
        if (!renameFor) return;
        socket.emit('renamePile', { pileId: renameFor, name: newName.trim() });
        setRenameFor(null);
        setNewName('');
    };

    const shufflePile = (pileId) => socket.emit('shufflePile', { pileId });

    const toggleFaceDown = (card) => {
        socket.emit('setCardField', { instanceId: card.instanceId, field: 'faceDown', value: !card.faceDown });
    };

    // Drag-drop support: move a card from anywhere into a pile by dropping on its header
    const handleDrop = (e, pileId) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));
            if (!data?.instanceId) return;
            socket.emit('moveCard', {
                instanceId: data.instanceId,
                fromZone: data.fromZone,
                toZone: `pile:${pileId}`,
                targetPlayerId: data.fromPlayerId,
            });
        } catch (_) {}
    };
    const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };

    const moveOutOfPile = (pile, card, toZone) => {
        socket.emit('moveCard', {
            instanceId: card.instanceId,
            fromZone: `pile:${pile.id}`,
            toZone,
            targetPlayerId: userId,
        });
    };

    return (
        <>
            {/* Floating toggle — left edge, below drawing toggle */}
            <button
                className={`piles-toggle ${open ? 'open' : ''}`}
                onClick={() => setOpen(o => !o)}
                title={open ? 'Hide piles' : 'Show piles'}
                type="button"
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="14" height="10" rx="1" />
                    <rect x="7" y="9" width="14" height="10" rx="1" />
                </svg>
                {(piles?.length > 0) && <span className="piles-toggle-badge">{piles.length}</span>}
            </button>

            {open && createPortal(
                <div className="piles-panel">
                    <div className="piles-panel-header">
                        <h3>Piles {totalCards > 0 && <span className="muted">({totalCards} cards)</span>}</h3>
                        <div className="piles-panel-actions">
                            {!spectating && (
                                <button className="small-btn primary-btn" onClick={() => setCreating(true)} type="button">+ New pile</button>
                            )}
                            <button className="icon-btn" onClick={() => setOpen(false)} title="Close">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                        </div>
                    </div>

                    {creating && (
                        <div className="pile-create-row">
                            <input
                                type="text"
                                placeholder="Pile name (optional)"
                                value={createName}
                                onChange={e => setCreateName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') createPile(); if (e.key === 'Escape') { setCreating(false); setCreateName(''); } }}
                                autoFocus
                            />
                            <button className="small-btn" onClick={createPile}>Create</button>
                            <button className="small-btn" onClick={() => { setCreating(false); setCreateName(''); }}>Cancel</button>
                        </div>
                    )}

                    <div className="piles-list">
                        {(piles || []).length === 0 && !creating && (
                            <div className="muted muted-centered">No piles yet. Click "+ New pile" to create one.</div>
                        )}
                        {(piles || []).map(pile => {
                            const isExpanded = expanded.has(pile.id);
                            const isRenaming = renameFor === pile.id;
                            return (
                                <div
                                    key={pile.id}
                                    className="pile-item"
                                    onDragOver={handleDragOver}
                                    onDrop={(e) => handleDrop(e, pile.id)}
                                    data-drop-zone={`pile:${pile.id}`}
                                    data-drop-player={userId}
                                >
                                    <div className="pile-header" onClick={() => togglePile(pile.id)}>
                                        <span className="pile-chevron">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                                        {isRenaming ? (
                                            <input
                                                type="text"
                                                value={newName}
                                                onChange={e => setNewName(e.target.value)}
                                                onClick={e => e.stopPropagation()}
                                                onKeyDown={e => {
                                                    e.stopPropagation();
                                                    if (e.key === 'Enter') renamePile();
                                                    if (e.key === 'Escape') { setRenameFor(null); setNewName(''); }
                                                }}
                                                autoFocus
                                            />
                                        ) : (
                                            <span className="pile-name">{pile.name}</span>
                                        )}
                                        <span className="pile-count">{pile.count}</span>
                                        {!spectating && (
                                            <div className="pile-actions" onClick={e => e.stopPropagation()}>
                                                {isRenaming ? (
                                                    <>
                                                        <button className="icon-btn" onClick={renamePile} title="Save">\u2713</button>
                                                        <button className="icon-btn" onClick={() => { setRenameFor(null); setNewName(''); }} title="Cancel">\u2715</button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button className="icon-btn" onClick={() => { setRenameFor(pile.id); setNewName(pile.name); }} title="Rename">\u270E</button>
                                                        <button className="icon-btn" onClick={() => shufflePile(pile.id)} title="Shuffle">\u21BB</button>
                                                        <button className="icon-btn" onClick={() => deletePile(pile.id)} title="Delete pile">\u2715</button>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {isExpanded && (
                                        <div className="pile-cards">
                                            {pile.cards.length === 0 && <div className="muted">Empty. Drag a card here or right-click a card to add.</div>}
                                            {pile.cards.map(card => (
                                                <div
                                                    key={card.instanceId}
                                                    className="pile-card"
                                                    title={card.name}
                                                    draggable={!spectating}
                                                    onDragStart={(e) => {
                                                        e.dataTransfer.setData('application/json', JSON.stringify({
                                                            instanceId: card.instanceId,
                                                            fromZone: `pile:${pile.id}`,
                                                            fromPlayerId: userId,
                                                        }));
                                                        e.dataTransfer.effectAllowed = 'move';
                                                    }}
                                                >
                                                    {card.imageUri && (
                                                        <img
                                                            src={card.faceDown ? '' : card.imageUri}
                                                            alt={card.name}
                                                            onClick={() => onMaximizeCard?.(card)}
                                                            draggable={false}
                                                        />
                                                    )}
                                                    <span className="pile-card-name">{card.faceDown ? 'Face down' : card.name}</span>
                                                    {!spectating && (
                                                        <div className="pile-card-actions">
                                                            <button className="small-btn" onClick={() => moveOutOfPile(pile, card, 'hand')} title="Move to your hand">\u2192 Hand</button>
                                                            <button className="small-btn" onClick={() => moveOutOfPile(pile, card, 'battlefield')} title="Play to your battlefield">\u2192 BF</button>
                                                            <button className="small-btn" onClick={() => toggleFaceDown(card)} title="Flip face up/down">Flip</button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
