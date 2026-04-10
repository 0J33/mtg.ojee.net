import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import socket from '../socket';
import { useEscapeKey } from '../utils';
import ManaCost, { OracleText } from './ManaCost';

const CARD_BACK = 'https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg';

export default function CardMaximized({ card, onClose, onClickCard, onAddNote }) {
    useEscapeKey(onClose);
    const [hoverThumb, setHoverThumb] = useState(null); // { url, x, y }
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

    return (
        <div className="modal-overlay">
            <div className="card-maximized">
                <img src={largeUrl} alt={card.name} />
                <div className="card-max-info">
                    <h3>{card.name}</h3>
                    {card.manaCost && <div className="mana-cost"><ManaCost cost={card.manaCost} /></div>}
                    <p className="type-line">{card.typeLine}</p>
                    {card.oracleText && <p className="oracle-text"><OracleText text={card.oracleText} /></p>}
                    {(card.power || card.toughness) && <p className="pt">{card.power}/{card.toughness}</p>}
                    {counterEntries.length > 0 && (
                        <div className="card-effects-section">
                            <div className="card-effects-section-head">
                                <strong>Counters</strong>
                                {card.instanceId && (
                                    <button
                                        className="small-btn"
                                        onClick={() => socket.emit('clearCardCounters', { instanceId: card.instanceId })}
                                    >Clear all</button>
                                )}
                            </div>
                            {counterEntries.map(([name, val]) => (
                                <div key={name} className="counter-line-max">
                                    <span>· <strong>{name}</strong> × {val}</span>
                                    {card.instanceId && (
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
                                        {card.instanceId && (
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
                    {onAddNote && card.instanceId && (
                        <div className="card-max-actions">
                            <button onClick={() => onAddNote(card.instanceId)} className="small-btn">+ Add Effect / Note</button>
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
        </div>
    );
}
