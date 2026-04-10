import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { scryfall } from '../api';
import socket from '../socket';
import { useEscapeKey } from '../utils';
import ManaCost from './ManaCost';

export default function CardSearch({ onClose, mode }) {
    useEscapeKey(onClose);
    // mode: 'token' (create token), 'add' (add card to battlefield), 'view' (just view)
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [count, setCount] = useState(1);
    const [hover, setHover] = useState(null);
    const debounceRef = useRef(null);

    const handleHover = (e, card) => {
        const face = card.card_faces?.[0];
        const url = card.image_uris?.large || card.image_uris?.normal || face?.image_uris?.large || face?.image_uris?.normal;
        if (!url) return;
        const x = e.clientX > window.innerWidth / 2 ? e.clientX - 340 : e.clientX + 20;
        const y = Math.max(10, Math.min(e.clientY - 60, window.innerHeight - 460));
        setHover({ url, x, y });
    };

    const handleSearch = (q) => {
        setQuery(q);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (q.length < 2) { setResults([]); return; }

        debounceRef.current = setTimeout(async () => {
            setLoading(true);
            const searchQuery = mode === 'token' ? `${q} is:token` : q;
            const data = await scryfall.search(searchQuery, { include_extras: mode === 'token' });
            setResults(data.data || []);
            setLoading(false);
        }, 300);
    };

    const handleSelect = (card) => {
        const face = card.card_faces?.[0];
        const cardData = {
            scryfallId: card.id,
            name: card.name,
            imageUri: card.image_uris?.normal || face?.image_uris?.normal || '',
            backImageUri: card.card_faces?.[1]?.image_uris?.normal || '',
            manaCost: card.mana_cost || face?.mana_cost || '',
            typeLine: card.type_line || face?.type_line || '',
            oracleText: card.oracle_text || face?.oracle_text || '',
            power: card.power || face?.power || '',
            toughness: card.toughness || face?.toughness || '',
            colors: card.colors || face?.colors || [],
            layout: card.layout || 'normal',
        };

        if (mode === 'token') {
            socket.emit('createToken', { cardData, count }, () => {});
        } else {
            socket.emit('createToken', { cardData, count: 1 }, () => {}); // creates on battlefield
        }
        onClose();
    };

    return (
        <div className="modal-overlay">
            <div className="modal card-search-modal">
                <div className="modal-header">
                    <h2>{mode === 'token' ? 'Search Tokens' : 'Search Cards'}</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <div className="search-row">
                    <input
                        type="text"
                        placeholder="Search cards (e.g. lightning bolt, t:creature, c:red)"
                        value={query}
                        onChange={e => handleSearch(e.target.value)}
                        autoFocus
                    />
                    {mode === 'token' && (
                        <div className="count-input">
                            <label>Count:</label>
                            <input type="number" min={1} max={99} value={count} onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))} />
                        </div>
                    )}
                </div>
                <div className="search-results">
                    {loading && <div className="muted">Searching...</div>}
                    {results.map(card => {
                        const face = card.card_faces?.[0];
                        const img = card.image_uris?.small || face?.image_uris?.small || '';
                        return (
                            <div key={card.id} className="search-result"
                                onClick={() => handleSelect(card)}
                                onMouseMove={(e) => handleHover(e, card)}
                                onMouseLeave={() => setHover(null)}>
                                {img && <img src={img} alt={card.name} />}
                                <div className="search-result-info">
                                    <strong>{card.name}</strong>
                                    <span className="muted">{card.type_line}</span>
                                    {card.mana_cost && <ManaCost cost={card.mana_cost} />}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            {hover && createPortal(
                <div className="card-zoom" style={{ left: hover.x, top: hover.y }}>
                    <img src={hover.url} alt="" />
                </div>,
                document.body
            )}
        </div>
    );
}
