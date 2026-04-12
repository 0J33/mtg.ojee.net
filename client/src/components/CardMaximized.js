import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import socket from '../socket';
import { useEscapeKey } from '../utils';
import ManaCost, { OracleText } from './ManaCost';

const CARD_BACK = 'https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg';

export default function CardMaximized({ card, onClose, onClickCard, onAddNote, onAddCounter, allPlayers, userId, currentZone, readOnly, attachedToName, attachments }) {
    useEscapeKey(onClose);
    const [hoverThumb, setHoverThumb] = useState(null); // { url, x, y }
    const [showRevealMenu, setShowRevealMenu] = useState(false);
    const [showMoveMenu, setShowMoveMenu] = useState(false);
    if (!card) return null;

    const isFaceDown = card.faceDown;
    const isFlipped = card.flipped && card.backImageUri;
    const imageUrl = isFaceDown
        ? CARD_BACK
        : isFlipped
            ? card.backImageUri
            : (card.imageUri || card.customImageUrl || CARD_BACK);

    const largeUrl = imageUrl.replace('/normal/', '/large/').replace('/small/', '/large/');
    const hasNotes = Array.isArray(card.notes) && card.notes.length > 0;
    const counterEntries = Object.entries(card.counters || {}).filter(([, v]) => v !== 0);

    const handleThumbHover = (e, imageUri) => {
        if (!imageUri) return;
        const x = e.clientX > window.innerWidth / 2 ? e.clientX - 340 : e.clientX + 20;
        const y = Math.max(10, Math.min(e.clientY - 60, window.innerHeight - 460));
        setHoverThumb({ url: imageUri, x, y });
    };

    // Portal to body with an elevated z-index so the maximized card always
    // renders ABOVE any other modal — e.g. if you click a card in the tutor
    // / library search, the zoomed view appears on top of that modal instead
    // of behind it.
    return createPortal(
        <div className="modal-overlay card-max-overlay">
            <div className="card-maximized">
                <img src={largeUrl} alt={card.name} />
                <div className="card-max-info">
                    <h3>{card.name}</h3>
                    {card.isCustom && (
                        <p className="custom-author-line">
                            Custom card{card.customCardAuthorUsername ? ` · by ${card.customCardAuthorUsername}` : ''}
                        </p>
                    )}
                    {card.manaCost && <div className="mana-cost"><ManaCost cost={card.manaCost} /></div>}
                    <p className="type-line">{card.typeLine}</p>
                    {card.oracleText && <p className="oracle-text"><OracleText text={card.oracleText} /></p>}
                    {(card.power || card.toughness) && <p className="pt">{card.power}/{card.toughness}</p>}
                    {counterEntries.length > 0 && (
                        <div className="card-effects-section">
                            <div className="card-effects-section-head">
                                <strong>Counters</strong>
                                {card.instanceId && !readOnly && (
                                    <button
                                        className="small-btn"
                                        onClick={() => socket.emit('clearCardCounters', { instanceId: card.instanceId })}
                                    >Clear all</button>
                                )}
                            </div>
                            {counterEntries.map(([name, val]) => (
                                <div key={name} className="counter-line-max">
                                    <span>· <strong>{name}</strong> × {val}</span>
                                    {card.instanceId && !readOnly && (
                                        <span className="counter-line-actions">
                                            <button
                                                className="counter-step-btn"
                                                title="Decrement"
                                                onClick={() => socket.emit('setCardCounter', { instanceId: card.instanceId, counter: name, value: val - 1 })}
                                            >−</button>
                                            <button
                                                className="counter-step-btn"
                                                title="Increment"
                                                onClick={() => socket.emit('setCardCounter', { instanceId: card.instanceId, counter: name, value: val + 1 })}
                                            >+</button>
                                            <button
                                                className="note-remove-btn"
                                                title="Remove counter"
                                                onClick={() => socket.emit('setCardCounter', { instanceId: card.instanceId, counter: name, value: 0 })}
                                            >×</button>
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {hasNotes && (
                        <div className="card-effects-section">
                            <strong>Effects / Notes</strong>
                            {card.notes.map((note, i) => {
                                const noteObj = typeof note === 'string' ? { text: note, card: null } : note;
                                return (
                                    <div key={i} className="note-line-max">
                                        {noteObj.card?.imageUri && (
                                            <img
                                                src={noteObj.card.imageUri}
                                                alt={noteObj.card.name}
                                                className="note-attached-thumb"
                                                onMouseMove={(e) => handleThumbHover(e, noteObj.card.imageUri)}
                                                onMouseLeave={() => setHoverThumb(null)}
                                            />
                                        )}
                                        <span className="note-text"><OracleText text={noteObj.text} /></span>
                                        {card.instanceId && !readOnly && (
                                            <button
                                                className="note-remove-btn"
                                                title="Remove note"
                                                onClick={() => socket.emit('removeCardNote', { instanceId: card.instanceId, index: i })}
                                            >×</button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {/* Attachment info — shows what this card is equipped to,
                        or what equipment/auras are attached to this card. */}
                    {attachedToName && (
                        <div className="card-effects-section">
                            <strong>Attached to</strong>
                            <div className="note-line-max">
                                <span className="note-text">🔗 {attachedToName}</span>
                            </div>
                        </div>
                    )}
                    {Array.isArray(attachments) && attachments.length > 0 && (
                        <div className="card-effects-section">
                            <strong>Equipped / Enchanted by</strong>
                            {attachments.map((att, i) => (
                                <div key={i} className="note-line-max">
                                    {att.imageUri && (
                                        <img
                                            src={att.imageUri}
                                            alt={att.name}
                                            className="note-attached-thumb"
                                            onMouseMove={(e) => handleThumbHover(e, att.imageUri)}
                                            onMouseLeave={() => setHoverThumb(null)}
                                        />
                                    )}
                                    <span className="note-text">🔗 {att.name}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {card.instanceId && !readOnly && (
                        <div className="card-max-actions">
                            {/* Quick actions row */}
                            <div className="card-max-action-row">
                                <button className="small-btn" onClick={() => socket.emit('tapCard', { instanceId: card.instanceId })}>
                                    {card.tapped ? 'Untap' : 'Tap'}
                                </button>
                                <button
                                    className="small-btn"
                                    onClick={() => socket.emit(
                                        card.backImageUri ? 'flipCard' : 'toggleFaceDown',
                                        { instanceId: card.instanceId },
                                    )}
                                    title="Flip — swaps sides on double-faced cards, otherwise toggles face-down"
                                >
                                    Flip
                                </button>
                                {onAddCounter && (
                                    <button className="small-btn" onClick={() => onAddCounter(card)}>+ Counter</button>
                                )}
                                {onAddNote && (
                                    <button className="small-btn" onClick={() => onAddNote(card.instanceId)}>+ Note</button>
                                )}
                            </div>

                            {/* Move card to a different zone */}
                            {currentZone && (
                                <div className="card-max-action-row">
                                    <span className="card-max-action-label">Move to:</span>
                                    {['hand', 'battlefield', 'graveyard', 'exile', 'commandZone', 'library'].filter(z => z !== currentZone).map(z => (
                                        <button key={z} className="small-btn" onClick={() => {
                                            socket.emit('moveCard', { instanceId: card.instanceId, fromZone: currentZone, toZone: z });
                                            onClose?.();
                                        }}>
                                            {z === 'commandZone' ? 'Cmd' : z === 'battlefield' ? 'BF' : z === 'graveyard' ? 'GY' : z.charAt(0).toUpperCase() + z.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Reveal */}
                            {allPlayers && (
                                <div className="card-max-action-row">
                                    <span className="card-max-action-label">Reveal:</span>
                                    <button className="small-btn" onClick={() => socket.emit('revealCard', { instanceId: card.instanceId, targetPlayerIds: 'all' })}>To all</button>
                                    {!showRevealMenu && allPlayers.filter(p => p.userId !== userId).length > 0 && (
                                        <button className="small-btn" onClick={() => setShowRevealMenu(true)}>To specific...</button>
                                    )}
                                    {showRevealMenu && allPlayers.filter(p => p.userId !== userId).map(p => (
                                        <button key={p.userId} className="small-btn" onClick={() => {
                                            socket.emit('revealCard', { instanceId: card.instanceId, targetPlayerIds: [p.userId] });
                                            setShowRevealMenu(false);
                                        }}>{p.username}</button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <button className="close-btn" onClick={onClose}>x</button>
            </div>
            {hoverThumb && createPortal(
                <div className="card-zoom" style={{ position: 'fixed', left: hoverThumb.x, top: hoverThumb.y, zIndex: 3500, pointerEvents: 'none' }}>
                    <img src={hoverThumb.url.replace('/normal/', '/large/').replace('/small/', '/large/')} alt="" />
                </div>,
                document.body
            )}
        </div>,
        document.body
    );
}
