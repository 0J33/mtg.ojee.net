import React, { useState } from 'react';

const CARD_BACK = 'https://backs.scryfall.io/large/59/597b79b3-7d77-4261-871a-60dd17403388.jpg?1562636778';

export default function Card({ card, onClick, onContextMenu, isDragging, small, showBack }) {
    const [hoverPos, setHoverPos] = useState(null);
    const [imgError, setImgError] = useState(false);

    const isFaceDown = card.faceDown || showBack;
    const isFlipped = card.flipped && card.backImageUri;
    const imageUrl = isFaceDown
        ? CARD_BACK
        : isFlipped
            ? card.backImageUri
            : (card.imageUri || card.customImageUrl || CARD_BACK);

    const handleMouseMove = (e) => {
        if (isDragging || small) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        // Position zoom card to the right or left depending on screen position
        const posX = x > window.innerWidth / 2 ? x - 320 : x + 20;
        const posY = Math.min(y - 40, window.innerHeight - 480);
        setHoverPos({ x: posX, y: Math.max(0, posY) });
    };

    const countersArray = card.counters
        ? Object.entries(typeof card.counters === 'object' ? card.counters : {}).filter(([, v]) => v !== 0)
        : [];

    return (
        <>
            <div
                className={`card ${card.tapped ? 'tapped' : ''} ${isDragging ? 'dragging' : ''} ${isFaceDown ? 'face-down' : ''}`}
                onClick={onClick}
                onContextMenu={onContextMenu}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHoverPos(null)}
            >
                <img
                    src={imgError ? CARD_BACK : imageUrl}
                    alt={isFaceDown ? 'Face-down card' : card.name}
                    onError={() => setImgError(true)}
                    draggable={false}
                />
                {countersArray.length > 0 && (
                    <div className="card-counters">
                        {countersArray.map(([name, val]) => (
                            <span key={name} className="counter-badge" title={name}>
                                {name}: {val}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Hover zoom */}
            {hoverPos && !isDragging && !isFaceDown && (
                <div className="card-zoom" style={{ left: hoverPos.x, top: hoverPos.y }}>
                    <img src={imageUrl.replace('/normal/', '/large/')} alt={card.name} />
                </div>
            )}
        </>
    );
}
