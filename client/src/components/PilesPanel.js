import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import socket from '../socket';
import { useDialog } from './Dialog';
import ContextMenu from './ContextMenu';
import { useVerticalDragPos } from '../utils';

const CARD_BACK = 'https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg';

const POS_KEY = 'mtg_piles_panel_pos';
const PANEL_W = 340;
const PANEL_H_DEFAULT = () => Math.min(window.innerHeight - 80, 600);

function loadPos() {
    try {
        const raw = localStorage.getItem(POS_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (typeof p?.left === 'number' && typeof p?.top === 'number') return p;
    } catch (_) {}
    return null;
}
function savePos(p) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (_) {}
}
function clampPos(p) {
    const w = Math.min(PANEL_W, window.innerWidth - 10);
    const h = PANEL_H_DEFAULT();
    return {
        left: Math.max(4, Math.min(p.left, window.innerWidth - w - 4)),
        top: Math.max(4, Math.min(p.top, window.innerHeight - Math.min(h, 120) - 4)),
    };
}

/**
 * Shared piles panel. Collapsible from a floating toggle button so it
 * doesn't take up board space by default. Any player can create, delete,
 * rename, shuffle, or move cards into any pile.
 *
 * Cards in piles are fully visible to everyone (like graveyard / exile).
 */
export default function PilesPanel({ piles, players, userId, onMaximizeCard, spectating }) {
    const dialog = useDialog();
    const [open, setOpen] = useState(false);
    const [expanded, setExpanded] = useState(new Set()); // expanded pile ids
    const [renameFor, setRenameFor] = useState(null);    // pileId
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [createName, setCreateName] = useState('');
    const [createPrivate, setCreatePrivate] = useState(false);
    const [pos, setPos] = useState(() => loadPos());
    const dragRef = useRef(null); // { startX, startY, origLeft, origTop, pointerId }
    const [cardMenu, setCardMenu] = useState(null); // { x, y, pile, card }
    const toggleDrag = useVerticalDragPos('mtg_piles_toggle_top');

    // Clamp on window resize so the panel can't get stuck off-screen.
    useEffect(() => {
        if (!pos) return;
        const onResize = () => setPos(p => (p ? clampPos(p) : p));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [pos]);

    const onHeaderPointerDown = (e) => {
        // Ignore clicks on buttons/inputs inside the header
        if (e.target.closest('button, input')) return;
        const panel = e.currentTarget.parentElement;
        if (!panel) return;
        const rect = panel.getBoundingClientRect();
        dragRef.current = {
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            startX: e.clientX,
            startY: e.clientY,
            pointerId: e.pointerId,
            moved: false,
        };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    };
    const onHeaderPointerMove = (e) => {
        const d = dragRef.current;
        if (!d || d.pointerId !== e.pointerId) return;
        if (!d.moved) {
            if (Math.abs(e.clientX - d.startX) <= 2 && Math.abs(e.clientY - d.startY) <= 2) return;
            d.moved = true;
            e.preventDefault();
        }
        setPos(clampPos({
            left: e.clientX - d.offsetX,
            top: e.clientY - d.offsetY,
        }));
    };
    const onHeaderPointerUp = (e) => {
        const d = dragRef.current;
        if (!d || d.pointerId !== e.pointerId) return;
        dragRef.current = null;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
        if (d.moved && pos) savePos(pos);
    };
    const resetPos = () => {
        setPos(null);
        try { localStorage.removeItem(POS_KEY); } catch (_) {}
    };

    const totalCards = (piles || []).reduce((n, p) => n + (p.count || 0), 0);

    const togglePile = (id) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const createPile = () => {
        const name = createName.trim();
        socket.emit('createPile', { name, private: createPrivate });
        setCreateName('');
        setCreatePrivate(false);
        setCreating(false);
    };

    const deletePile = async (pile) => {
        const ok = await dialog.confirm(
            pile.private
                ? `Delete private pile "${pile.name}"? Cards will go back to your hand.`
                : `Delete pile "${pile.name}"? Cards will return to the creator's hand.`,
            { title: 'Delete pile', danger: true, confirmLabel: 'Delete' },
        );
        if (!ok) return;
        socket.emit('deletePile', { pileId: pile.id });
    };

    const renamePile = () => {
        if (!renameFor) return;
        socket.emit('renamePile', { pileId: renameFor, name: newName.trim() });
        setRenameFor(null);
        setNewName('');
    };

    const shufflePile = (pileId) => socket.emit('shufflePile', { pileId });
    const togglePilePrivate = (pile) => {
        socket.emit('setPilePrivate', { pileId: pile.id, private: !pile.private });
    };

    // Flip a card in a pile. DFC cards swap sides; one-sided cards toggle face-down.
    const flipPileCard = (card) => {
        socket.emit(
            card.backImageUri ? 'flipCard' : 'toggleFaceDown',
            { instanceId: card.instanceId },
        );
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
            {/* Floating toggle — left edge, below drawing toggle. Drag vertically to move. */}
            <button
                className={`piles-toggle ${open ? 'open' : ''}`}
                onClick={() => setOpen(o => !o)}
                title={open ? 'Hide piles (drag vertically to move)' : 'Show piles (drag vertically to move)'}
                type="button"
                style={toggleDrag.topStyle}
                {...toggleDrag.dragHandlers}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="14" height="10" rx="1" />
                    <rect x="7" y="9" width="14" height="10" rx="1" />
                </svg>
                {(piles?.length > 0) && <span className="piles-toggle-badge">{piles.length}</span>}
            </button>

            {open && createPortal(
                <div
                    className={`piles-panel ${pos ? 'piles-panel-floating' : ''}`}
                    style={pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : undefined}
                >
                    <div
                        className="piles-panel-header"
                        onPointerDown={onHeaderPointerDown}
                        onPointerMove={onHeaderPointerMove}
                        onPointerUp={onHeaderPointerUp}
                        onPointerCancel={onHeaderPointerUp}
                        title="Drag to move"
                    >
                        <span className="piles-drag-grip" aria-hidden="true" title="Drag to move">
                            <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
                                <circle cx="3" cy="3" r="1.2"/><circle cx="9" cy="3" r="1.2"/>
                                <circle cx="3" cy="8" r="1.2"/><circle cx="9" cy="8" r="1.2"/>
                                <circle cx="3" cy="13" r="1.2"/><circle cx="9" cy="13" r="1.2"/>
                            </svg>
                        </span>
                        <h3>Piles {totalCards > 0 && <span className="muted">({totalCards} cards)</span>}</h3>
                        <div className="piles-panel-actions">
                            {!spectating && (
                                <button className="small-btn primary-btn" onClick={() => setCreating(true)} type="button">+ New pile</button>
                            )}
                            {pos && (
                                <button className="icon-btn" onClick={resetPos} title="Reset position" type="button">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 3 3 9 9 9"/></svg>
                                </button>
                            )}
                            <button className="icon-btn" onClick={() => setOpen(false)} title="Close">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                        </div>
                    </div>

                    {creating && (
                        <div className="pile-create-row">
                            <div className="pile-create-name">
                                <input
                                    type="text"
                                    placeholder="Pile name (optional)"
                                    value={createName}
                                    onChange={e => setCreateName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') createPile(); if (e.key === 'Escape') { setCreating(false); setCreateName(''); setCreatePrivate(false); } }}
                                    autoFocus
                                />
                                <label className="pile-private-toggle" title="Private piles are only visible to you">
                                    <input type="checkbox" checked={createPrivate} onChange={e => setCreatePrivate(e.target.checked)} />
                                    <span>Private</span>
                                </label>
                            </div>
                            <div className="pile-create-actions">
                                <button className="small-btn primary-btn" onClick={createPile}>Create</button>
                                <button className="small-btn" onClick={() => { setCreating(false); setCreateName(''); setCreatePrivate(false); }}>Cancel</button>
                            </div>
                        </div>
                    )}

                    <div className="piles-list">
                        {(piles || []).length === 0 && !creating && (
                            <div className="muted muted-centered">No piles yet. Click "+ New pile" to create one.</div>
                        )}
                        {(piles || []).map(pile => {
                            const isExpanded = expanded.has(pile.id);
                            const isRenaming = renameFor === pile.id;
                            // On a private pile, mutating actions are gated to the creator.
                            const isOwner = !pile.createdBy || pile.createdBy === userId;
                            const canMutate = !spectating && (!pile.private || isOwner);
                            return (
                                <div
                                    key={pile.id}
                                    className={`pile-item ${pile.private ? 'pile-private' : ''}`}
                                    onDragOver={handleDragOver}
                                    onDrop={(e) => handleDrop(e, pile.id)}
                                    data-drop-zone={`pile:${pile.id}`}
                                    data-drop-player={userId}
                                >
                                    <div className="pile-header" onClick={() => togglePile(pile.id)}>
                                        <span className="pile-chevron">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                                        {pile.private && (
                                            <span className="pile-private-badge" title={isOwner ? 'Private — only you can see these cards' : 'Private pile'}>
                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                            </span>
                                        )}
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
                                        {canMutate && (
                                            <div className="pile-actions" onClick={e => e.stopPropagation()}>
                                                {isRenaming ? (
                                                    <>
                                                        <button className="icon-btn" onClick={renamePile} title="Save">
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                                        </button>
                                                        <button className="icon-btn" onClick={() => { setRenameFor(null); setNewName(''); }} title="Cancel">
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        {isOwner && (
                                                            <button
                                                                className="icon-btn"
                                                                onClick={() => togglePilePrivate(pile)}
                                                                title={pile.private ? 'Make public' : 'Make private'}
                                                            >
                                                                {pile.private ? (
                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                                                                ) : (
                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                                                )}
                                                            </button>
                                                        )}
                                                        <button className="icon-btn" onClick={() => { setRenameFor(pile.id); setNewName(pile.name); }} title="Rename">
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                                                        </button>
                                                        <button className="icon-btn" onClick={() => shufflePile(pile.id)} title="Shuffle">
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                                                        </button>
                                                        <button className="icon-btn" onClick={() => deletePile(pile)} title="Delete pile">
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {isExpanded && (
                                        <div className="pile-cards">
                                            {pile.cards.length === 0 && <div className="muted">Empty. Drag a card here or right-click a card to add.</div>}
                                            {pile.cards.map(card => {
                                                const displayedImage = card.faceDown
                                                    ? CARD_BACK
                                                    : (card.flipped && card.backImageUri ? card.backImageUri : (card.skinUrl || card.imageUri));
                                                return (
                                                    <div
                                                        key={card.instanceId}
                                                        className="pile-card"
                                                        title={card.name}
                                                        draggable={canMutate}
                                                        onDragStart={(e) => {
                                                            e.dataTransfer.setData('application/json', JSON.stringify({
                                                                instanceId: card.instanceId,
                                                                fromZone: `pile:${pile.id}`,
                                                                fromPlayerId: userId,
                                                            }));
                                                            e.dataTransfer.effectAllowed = 'move';
                                                        }}
                                                        onClick={(e) => {
                                                            // Ignore clicks that originate on the per-card
                                                            // action buttons — those have their own handlers.
                                                            if (e.target.closest('button')) return;
                                                            onMaximizeCard?.(card);
                                                        }}
                                                        onContextMenu={(e) => {
                                                            if (!canMutate) return;
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setCardMenu({ x: e.clientX, y: e.clientY, pile, card });
                                                        }}
                                                    >
                                                        <img
                                                            src={displayedImage}
                                                            alt={card.faceDown ? 'Face-down card' : card.name}
                                                            draggable={false}
                                                        />
                                                        <span className="pile-card-name">{card.faceDown ? 'Face down' : card.name}</span>
                                                        {canMutate && (
                                                            <div className="pile-card-actions">
                                                                <button className="small-btn" onClick={(e) => { e.stopPropagation(); moveOutOfPile(pile, card, 'hand'); }} title="Move to your hand">{'\u2192'} Hand</button>
                                                                <button className="small-btn" onClick={(e) => { e.stopPropagation(); moveOutOfPile(pile, card, 'battlefield'); }} title="Play to your battlefield">{'\u2192'} BF</button>
                                                                <button className="small-btn" onClick={(e) => { e.stopPropagation(); flipPileCard(card); }} title={card.backImageUri ? 'Flip (swap sides)' : 'Flip face up/down'}>Flip</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>,
                document.body
            )}
            {cardMenu && (
                <ContextMenu
                    x={cardMenu.x}
                    y={cardMenu.y}
                    items={[
                        { label: 'View', onClick: () => onMaximizeCard?.(cardMenu.card) },
                        { divider: true },
                        { label: '→ Hand', onClick: () => moveOutOfPile(cardMenu.pile, cardMenu.card, 'hand') },
                        { label: '→ Battlefield', onClick: () => moveOutOfPile(cardMenu.pile, cardMenu.card, 'battlefield') },
                        { label: '→ Graveyard', onClick: () => moveOutOfPile(cardMenu.pile, cardMenu.card, 'graveyard') },
                        { label: '→ Exile', onClick: () => moveOutOfPile(cardMenu.pile, cardMenu.card, 'exile') },
                        { label: '→ Library (top)', onClick: () => {
                            socket.emit('moveCard', { instanceId: cardMenu.card.instanceId, fromZone: `pile:${cardMenu.pile.id}`, toZone: 'library', libraryPosition: 'top', targetPlayerId: userId });
                        } },
                        { label: '→ Library (bottom)', onClick: () => {
                            socket.emit('moveCard', { instanceId: cardMenu.card.instanceId, fromZone: `pile:${cardMenu.pile.id}`, toZone: 'library', targetPlayerId: userId });
                        } },
                        { divider: true },
                        { label: cardMenu.card.backImageUri ? 'Flip (swap sides)' : 'Flip face up/down', onClick: () => flipPileCard(cardMenu.card) },
                        // Moving to another pile — listed last.
                        ...(piles || []).filter(p => p.id !== cardMenu.pile.id).map(p => ({
                            label: `→ Pile: ${p.name}`,
                            onClick: () => socket.emit('moveCard', {
                                instanceId: cardMenu.card.instanceId,
                                fromZone: `pile:${cardMenu.pile.id}`,
                                toZone: `pile:${p.id}`,
                                targetPlayerId: userId,
                            }),
                        })),
                    ]}
                    onClose={() => setCardMenu(null)}
                />
            )}
        </>
    );
}
