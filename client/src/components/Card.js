import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { OracleText } from './ManaCost';

const CARD_BACK = 'https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg';

export default function Card({ card, onClick, onContextMenu, isDragging, small, showBack, draggable, onDragStart, onDragEnd, disableHover }) {
    const [hoverPos, setHoverPos] = useState(null);
    const [imgError, setImgError] = useState(false);
    const cardRef = useRef(null);

    const isFaceDown = card.faceDown || showBack;
    const hasBack = !!card.backImageUri;
    const isFlipped = card.flipped && hasBack;
    const frontImage = card.imageUri || card.customImageUrl || CARD_BACK;
    const imageUrl = isFaceDown
        ? CARD_BACK
        : isFlipped
            ? card.backImageUri
            : frontImage;

    useEffect(() => { setImgError(false); }, [imageUrl]);

    const handleMouseEnter = () => {
        if (isDragging || small || disableHover) return;
        const el = cardRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const zoomW = 320;
        // Only reserve room for the side panel if this card actually has
        // counters/notes to display. Before this fix we reserved 260px + gap
        // even for empty cards, which pushed left-side placements 260px too
        // far off the left edge of the card the user was hovering.
        const hasSideEffects = (Array.isArray(card.notes) && card.notes.length > 0)
            || (card.counters && Object.values(card.counters).some(v => v !== 0));
        const panelW = hasSideEffects ? 260 : 0;
        const gap = hasSideEffects ? 8 : 0;
        const totalWidth = zoomW + panelW + gap;
        const ZOOM_H = 460;
        // Place to the right of the card by default; if not enough space, place to the left.
        // When flipped to the left, the preview extends leftward from the card,
        // so posX = rect.left - totalWidth - margin.
        const spaceRight = window.innerWidth - rect.right;
        let posX;
        if (spaceRight >= totalWidth + 20) {
            posX = rect.right + 12;
        } else if (rect.left >= totalWidth + 20) {
            posX = rect.left - totalWidth - 12;
        } else {
            // Not enough space either side; pin to wider side and clamp
            posX = spaceRight > rect.left
                ? Math.min(rect.right + 12, window.innerWidth - totalWidth - 10)
                : Math.max(10, rect.left - totalWidth - 12);
        }
        let posY = rect.top + rect.height / 2 - ZOOM_H / 2;
        posY = Math.max(10, Math.min(posY, window.innerHeight - ZOOM_H - 10));
        setHoverPos({ x: posX, y: posY });
    };

    const counterEntries = Object.entries(card.counters || {}).filter(([, v]) => v !== 0);
    const hasCounters = counterEntries.length > 0;
    const hasNotes = Array.isArray(card.notes) && card.notes.length > 0;
    const hasEffects = hasCounters || hasNotes;
    const damage = typeof card.damage === 'number' && card.damage > 0 ? card.damage : 0;
    const phasedOut = !!card.phasedOut;
    const suspendCount = typeof card.suspendCounters === 'number' && card.suspendCounters > 0 ? card.suspendCounters : 0;
    const goaded = !!card.goaded;
    const attacking = !!card.attackingPlayerId;
    const tempControlled = !!card.controllerOriginal;
    const attached = !!card.attachedTo;
    const largeImageUrl = (imageUrl || CARD_BACK).replace('/normal/', '/large/').replace('/small/', '/large/');

    return (
        <>
            <div
                ref={cardRef}
                className={`card ${card.tapped ? 'tapped' : ''} ${isDragging ? 'dragging' : ''} ${isFaceDown ? 'face-down' : ''} ${hasEffects ? 'has-effects' : ''} ${phasedOut ? 'phased-out' : ''} ${attacking ? 'attacking' : ''} ${tempControlled ? 'temp-controlled' : ''}`}
                onClick={onClick}
                onContextMenu={onContextMenu}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={() => setHoverPos(null)}
                draggable={draggable}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
            >
                <img
                    src={imgError ? CARD_BACK : imageUrl}
                    alt={isFaceDown ? 'Face-down card' : card.name}
                    onError={() => setImgError(true)}
                    draggable={false}
                />
                {hasEffects && <div className="effect-indicator" title="Has counters/notes">!</div>}
                {/* Damage marker — wears off at end of turn server-side */}
                {damage > 0 && <div className="card-damage-badge" title={`${damage} damage marked`}>{damage}</div>}
                {/* Suspend counters — tick down each upkeep server-side */}
                {suspendCount > 0 && <div className="card-suspend-badge" title={`${suspendCount} time counter(s)`}>⌛{suspendCount}</div>}
                {goaded && <div className="card-goad-badge" title="Goaded — must attack">⚔</div>}
                {tempControlled && <div className="card-temp-control-badge" title="Under temporary control (returns end of turn)">↶</div>}
                {attached && <div className="card-attached-badge" title="Attached (equipped/enchanted)">⚔</div>}
            </div>

            {/* Hover zoom + side effects panel */}
            {hoverPos && !isDragging && !isFaceDown && createPortal(
                <div className="card-zoom-wrapper" style={{ left: hoverPos.x, top: hoverPos.y }}>
                    <div className="card-zoom">
                        <img src={largeImageUrl} alt={card.name} />
                    </div>
                    {hasEffects && (
                        <div className="card-effects-panel">
                            {hasCounters && (
                                <div className="effect-group">
                                    <div className="effect-group-label">Counters</div>
                                    {counterEntries.map(([name, val]) => (
                                        <div key={name} className="effect-line counter-effect">
                                            <span className="effect-icon counter-icon">+</span>
                                            <span><strong>{name}</strong> × {val}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {hasNotes && (
                                <div className="effect-group">
                                    <div className="effect-group-label">Effects / Notes</div>
                                    {card.notes.map((note, i) => {
                                        const noteObj = typeof note === 'string' ? { text: note, card: null } : note;
                                        return (
                                            <div key={i} className="effect-line note-effect">
                                                {noteObj.card?.imageUri && (
                                                    <img src={noteObj.card.imageUri} alt={noteObj.card.name} className="effect-card-thumb" />
                                                )}
                                                <span><OracleText text={noteObj.text} /></span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>,
                document.body
            )}
        </>
    );
}
