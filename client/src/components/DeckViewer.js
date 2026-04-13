import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { decks } from '../api';
import { useEscapeKey } from '../utils';
import { useDialog } from './Dialog';
import ManaCost from './ManaCost';

export default function DeckViewer({ deckId, onClose, onDelete, onEdit }) {
    useEscapeKey(onClose);
    const dialog = useDialog();
    const [deck, setDeck] = useState(null);
    const [loading, setLoading] = useState(true);
    const [hoveredCard, setHoveredCard] = useState(null);
    const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

    useEffect(() => {
        decks.get(deckId).then(data => {
            if (data.deck) setDeck(data.deck);
            setLoading(false);
        });
    }, [deckId]);

    const handleHover = (e, card) => {
        if (!card.imageUri) return;
        setHoveredCard(card);
        const rect = e.currentTarget.getBoundingClientRect();
        const ZOOM_W = 320;
        const ZOOM_H = 460;
        // Place to the side of the row, not the cursor
        const spaceRight = window.innerWidth - rect.right;
        let posX;
        if (spaceRight >= ZOOM_W + 20) posX = rect.right + 12;
        else if (rect.left >= ZOOM_W + 20) posX = rect.left - ZOOM_W - 12;
        else posX = Math.max(10, window.innerWidth - ZOOM_W - 10);
        let posY = rect.top + rect.height / 2 - ZOOM_H / 2;
        posY = Math.max(10, Math.min(posY, window.innerHeight - ZOOM_H - 10));
        setHoverPos({ x: posX, y: posY });
    };

    if (loading) return (
        <div className="modal-overlay">
            <div className="modal"><p className="muted">Loading...</p></div>
        </div>
    );

    if (!deck) return (
        <div className="modal-overlay">
            <div className="modal">
                <div className="modal-header">
                    <h2>Deck not found</h2>
                    <button className="close-btn" onClick={onClose}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
            </div>
        </div>
    );

    const allEntries = [...(deck.commanders || []), ...(deck.mainboard || []), ...(deck.sideboard || []), ...(deck.companions || [])];
    const totalCount = allEntries.reduce((s, c) => s + (c.quantity || 1), 0);
    const uniqueCount = allEntries.length;

    const renderCardList = (cards) => (
        <div className="deck-card-list">
            {cards?.map((c, i) => (
                <div key={i} className="deck-card-line"
                    onMouseEnter={(e) => handleHover(e, c)}
                    onMouseLeave={() => setHoveredCard(null)}>
                    <span className="deck-card-qty">{c.quantity || 1}x</span>
                    <span className="deck-card-name">
                        {c.name}
                        {c.isCustom && c.customCardAuthorUsername && (
                            <span className="custom-author-badge"> custom · by {c.customCardAuthorUsername}</span>
                        )}
                    </span>
                    <span className="deck-card-mana">{c.manaCost && <ManaCost cost={c.manaCost} />}</span>
                </div>
            ))}
        </div>
    );

    return (
        <div className="modal-overlay">
            <div className="modal deck-viewer">
                <div className="modal-header">
                    <h2>{deck.name}</h2>
                    <button className="close-btn" onClick={onClose}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
                <p className="muted">
                    {totalCount} cards ({uniqueCount} unique) · {deck.format}
                    {deck.tokens?.length > 0 && ` · ${deck.tokens.length} tokens`}
                    {deck.sharedByUsername && (
                        <> · <span className="deck-author-badge">shared by {deck.sharedByUsername}</span></>
                    )}
                    {deck.importedFrom && (
                        <> · <a href={deck.importedFrom} target="_blank" rel="noopener noreferrer" className="deck-source-link">source</a></>
                    )}
                </p>

                {deck.commanders?.length > 0 && (
                    <div className="preview-section">
                        <strong>Commander ({deck.commanders.length})</strong>
                        {renderCardList(deck.commanders)}
                    </div>
                )}
                {deck.companions?.length > 0 && (
                    <div className="preview-section">
                        <strong>Companion</strong>
                        {renderCardList(deck.companions)}
                    </div>
                )}
                <div className="preview-section">
                    <strong>Mainboard ({deck.mainboard?.length || 0})</strong>
                    {renderCardList(deck.mainboard)}
                </div>
                {deck.sideboard?.length > 0 && (
                    <div className="preview-section">
                        <strong>Sideboard ({deck.sideboard.length})</strong>
                        {renderCardList(deck.sideboard)}
                    </div>
                )}
                {deck.tokens?.length > 0 && (
                    <div className="preview-section">
                        <strong>Tokens ({deck.tokens.length})</strong>
                        {renderCardList(deck.tokens)}
                    </div>
                )}
                {deck.notFound?.length > 0 && (
                    <div className="preview-section error">
                        <strong>Missing Cards ({deck.notFound.length})</strong>
                        <div className="preview-scroll">
                            {deck.notFound.map((name, i) => <div key={i}>· {name}</div>)}
                        </div>
                    </div>
                )}

                <div className="modal-actions">
                    <button onClick={() => onEdit?.(deck._id)} className="primary-btn">Edit Deck</button>
                    <button className="danger" onClick={async () => {
                        const ok = await dialog.confirm(`Delete deck "${deck.name}"?`, { title: 'Delete deck', danger: true, confirmLabel: 'Delete' });
                        if (ok) { onDelete(deck._id); onClose(); }
                    }}>Delete Deck</button>
                </div>
            </div>

            {hoveredCard && hoveredCard.imageUri && createPortal(
                <div
                    className="card-zoom"
                    style={{
                        position: 'fixed',
                        left: hoverPos.x,
                        top: hoverPos.y,
                        zIndex: 4000,
                        pointerEvents: 'none',
                    }}
                >
                    <img src={hoveredCard.imageUri} alt={hoveredCard.name} />
                </div>,
                document.body
            )}
        </div>
    );
}
