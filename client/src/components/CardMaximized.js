import React from 'react';

const CARD_BACK = 'https://backs.scryfall.io/large/59/597b79b3-7d77-4261-871a-60dd17403388.jpg?1562636778';

export default function CardMaximized({ card, onClose }) {
    if (!card) return null;

    const isFaceDown = card.faceDown;
    const isFlipped = card.flipped && card.backImageUri;
    const imageUrl = isFaceDown
        ? CARD_BACK
        : isFlipped
            ? card.backImageUri
            : (card.imageUri || card.customImageUrl || CARD_BACK);

    // Use large/png version for maximized view
    const largeUrl = imageUrl.replace('/normal/', '/large/').replace('/small/', '/large/');

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="card-maximized" onClick={e => e.stopPropagation()}>
                <img src={largeUrl} alt={card.name} />
                <div className="card-max-info">
                    <h3>{card.name}</h3>
                    {card.manaCost && <p className="mana-cost">{card.manaCost}</p>}
                    <p className="type-line">{card.typeLine}</p>
                    {card.oracleText && <p className="oracle-text">{card.oracleText}</p>}
                    {(card.power || card.toughness) && <p className="pt">{card.power}/{card.toughness}</p>}
                </div>
                <button className="close-btn" onClick={onClose}>x</button>
            </div>
        </div>
    );
}
