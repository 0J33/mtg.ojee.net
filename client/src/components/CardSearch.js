import React, { useState, useRef } from 'react';
import { scryfall } from '../api';
import socket from '../socket';
import { useEscapeKey } from '../utils';
import ManaCost from './ManaCost';
import { DFC_LAYOUTS, extractFaces } from '../cardFaces';
import CardHoverPreview, { computeHoverPos } from './CardHoverPreview';

// Normalize a raw Scryfall card into the shape CardHoverPreview expects
// (imageUri / oracleText / typeLine / faces / keywords / etc.). Used by
// search / draft flows that work with Scryfall results directly.
function scryfallToHoverCard(card) {
    const face = card.card_faces?.[0];
    const isDfc = DFC_LAYOUTS.has(card.layout);
    return {
        name: card.name,
        imageUri: card.image_uris?.normal || face?.image_uris?.normal || '',
        backImageUri: isDfc ? (card.card_faces?.[1]?.image_uris?.normal || '') : '',
        manaCost: card.mana_cost || face?.mana_cost || '',
        typeLine: card.type_line || face?.type_line || '',
        oracleText: card.oracle_text || face?.oracle_text || '',
        power: card.power || face?.power || '',
        toughness: card.toughness || face?.toughness || '',
        layout: card.layout || 'normal',
        faces: extractFaces(card),
        keywords: Array.isArray(card.keywords) ? card.keywords : [],
        textless: !!card.textless,
        nonEnglish: !!(card.lang && card.lang !== 'en'),
    };
}

export default function CardSearch({ onClose, mode, deckTokens }) {
    useEscapeKey(onClose);
    // mode: 'token' (create token), 'add' (add card to battlefield), 'view' (just view)
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [count, setCount] = useState(1);
    const [hover, setHover] = useState(null);
    const debounceRef = useRef(null);

    const handleHover = (e, card) => {
        const hoverCard = scryfallToHoverCard(card);
        if (!hoverCard.imageUri) return;
        setHover({ card: hoverCard, pos: computeHoverPos(e) });
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
        const isDfc = DFC_LAYOUTS.has(card.layout);
        const cardData = {
            scryfallId: card.id,
            name: card.name,
            imageUri: card.image_uris?.normal || face?.image_uris?.normal || '',
            backImageUri: isDfc ? (card.card_faces?.[1]?.image_uris?.normal || '') : '',
            manaCost: card.mana_cost || face?.mana_cost || '',
            typeLine: card.type_line || face?.type_line || '',
            oracleText: card.oracle_text || face?.oracle_text || '',
            power: card.power || face?.power || '',
            toughness: card.toughness || face?.toughness || '',
            colors: card.colors || face?.colors || [],
            layout: card.layout || 'normal',
            faces: extractFaces(card),
            keywords: Array.isArray(card.keywords) ? card.keywords : [],
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
                    <button className="close-btn" onClick={onClose}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
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
                {/* Deck tokens — quick-spawn section at the top of token search */}
                {mode === 'token' && Array.isArray(deckTokens) && deckTokens.length > 0 && !query && (
                    <div className="deck-tokens-section">
                        <div className="deck-tokens-label">Deck tokens</div>
                        <div className="deck-tokens-grid">
                            {deckTokens.map((t, i) => {
                                const img = t.imageUri ? t.imageUri.replace('/normal/', '/small/') : '';
                                return (
                                    <div key={i} className="deck-token-item"
                                        onClick={() => { handleSelect({ id: t.scryfallId, name: t.name, image_uris: { normal: t.imageUri, small: img }, mana_cost: t.manaCost, type_line: t.typeLine, oracle_text: t.oracleText, power: t.power, toughness: t.toughness, colors: t.colors, layout: t.layout }); }}
                                        onMouseMove={(e) => handleHover(e, { image_uris: { large: t.imageUri, normal: t.imageUri } })}
                                        onMouseLeave={() => setHover(null)}
                                    >
                                        {img && <img src={img} alt={t.name} />}
                                        <span className="deck-token-name">{t.name}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
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
            <CardHoverPreview card={hover?.card || null} pos={hover?.pos || null} />
        </div>
    );
}
