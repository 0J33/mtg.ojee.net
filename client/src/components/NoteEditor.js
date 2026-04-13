import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import socket from '../socket';
import { scryfall } from '../api';
import { useEscapeKey } from '../utils';

export default function NoteEditor({ instanceId, onClose }) {
    useEscapeKey(onClose);
    const [text, setText] = useState('');
    const [cardQuery, setCardQuery] = useState('');
    const [cardResults, setCardResults] = useState([]);
    const [selectedCard, setSelectedCard] = useState(null);
    const [searching, setSearching] = useState(false);
    const debounceRef = useRef(null);

    const handleSearch = (q) => {
        setCardQuery(q);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (q.length < 2) { setCardResults([]); return; }
        debounceRef.current = setTimeout(async () => {
            setSearching(true);
            const data = await scryfall.search(q);
            setCardResults((data.data || []).slice(0, 6));
            setSearching(false);
        }, 300);
    };

    const handleSelectCard = (card) => {
        const face = card.card_faces?.[0];
        setSelectedCard({
            name: card.name,
            imageUri: card.image_uris?.normal || face?.image_uris?.normal || '',
        });
        setCardQuery(card.name);
        setCardResults([]);
    };

    const handleSave = () => {
        if (!text.trim()) return;
        socket.emit('addCardNote', { instanceId, note: { text: text.trim(), card: selectedCard } }, () => {});
        onClose();
    };

    return createPortal(
        <div className="modal-overlay">
            <div className="modal note-editor-modal">
                <div className="modal-header">
                    <h2>Add Effect / Note</h2>
                    <button className="close-btn" onClick={onClose}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
                <input
                    type="text"
                    placeholder="Effect description (e.g. Has flying, +2/+2 until EOT)"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSave()}
                    autoFocus
                />
                <div className="note-card-section">
                    <label className="muted">Attach card (optional)</label>
                    <input
                        type="text"
                        placeholder="Search a card to attach..."
                        value={cardQuery}
                        onChange={e => { handleSearch(e.target.value); setSelectedCard(null); }}
                    />
                    {searching && <div className="muted">Searching...</div>}
                    {cardResults.length > 0 && (
                        <div className="note-card-results">
                            {cardResults.map(card => {
                                const face = card.card_faces?.[0];
                                const img = card.image_uris?.small || face?.image_uris?.small || '';
                                return (
                                    <div key={card.id} className="note-card-result" onClick={() => handleSelectCard(card)}>
                                        {img && <img src={img} alt={card.name} />}
                                        <span>{card.name}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {selectedCard && (
                        <div className="note-selected-card">
                            {selectedCard.imageUri && <img src={selectedCard.imageUri} alt={selectedCard.name} />}
                            <span>Attached: <strong>{selectedCard.name}</strong></span>
                            <button className="small-btn" onClick={() => { setSelectedCard(null); setCardQuery(''); }}>Remove</button>
                        </div>
                    )}
                </div>
                <div className="modal-actions">
                    <button onClick={onClose}>Cancel</button>
                    <button onClick={handleSave} className="primary-btn" disabled={!text.trim()}>Save</button>
                </div>
            </div>
        </div>,
        document.body
    );
}
