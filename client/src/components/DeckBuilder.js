import React, { useState, useRef, useEffect } from 'react';
import { decks, customCards, scryfall } from '../api';
import { useEscapeKey } from '../utils';
import { useDialog } from './Dialog';
import ManaCost from './ManaCost';

export default function DeckBuilder({ deckId, onClose, onSaved }) {
    useEscapeKey(onClose);
    const dialog = useDialog();
    const [name, setName] = useState('Untitled Deck');
    const [commanders, setCommanders] = useState([]);
    const [mainboard, setMainboard] = useState([]);
    const [sideboard, setSideboard] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [savedCustomCards, setSavedCustomCards] = useState([]);
    const [tab, setTab] = useState('search'); // search, custom, deck
    const [saving, setSaving] = useState(false);
    const debounceRef = useRef(null);

    useEffect(() => {
        if (deckId) {
            decks.get(deckId).then(data => {
                if (data.deck) {
                    setName(data.deck.name);
                    setCommanders(data.deck.commanders || []);
                    setMainboard(data.deck.mainboard || []);
                    setSideboard(data.deck.sideboard || []);
                }
            });
        }
        customCards.list().then(data => {
            if (data.cards) setSavedCustomCards(data.cards);
        });
    }, [deckId]);

    const handleSearch = (q) => {
        setSearchQuery(q);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (q.length < 2) { setSearchResults([]); return; }
        debounceRef.current = setTimeout(async () => {
            setSearchLoading(true);
            const data = await scryfall.search(q);
            setSearchResults(data.data || []);
            setSearchLoading(false);
        }, 300);
    };

    const scryfallCardToEntry = (card) => {
        const face = card.card_faces?.[0];
        return {
            scryfallId: card.id,
            name: card.name,
            quantity: 1,
            imageUri: card.image_uris?.normal || face?.image_uris?.normal || '',
            backImageUri: card.card_faces?.[1]?.image_uris?.normal || '',
            manaCost: card.mana_cost || face?.mana_cost || '',
            typeLine: card.type_line || face?.type_line || '',
            oracleText: card.oracle_text || face?.oracle_text || '',
            power: card.power || face?.power || '',
            toughness: card.toughness || face?.toughness || '',
            colors: card.colors || face?.colors || [],
            colorIdentity: card.color_identity || [],
            producedMana: card.produced_mana || [],
            layout: card.layout || 'normal',
        };
    };

    const customToEntry = (cc) => ({
        scryfallId: null,
        name: cc.name,
        quantity: 1,
        imageUri: cc.imageUrl || '',
        manaCost: cc.manaCost || '',
        typeLine: cc.typeLine || '',
        oracleText: cc.oracleText || '',
        power: cc.power || '',
        toughness: cc.toughness || '',
        colors: cc.colors || [],
        isCustom: true,
        customImageUrl: cc.imageUrl || '',
        customCardId: cc._id,
    });

    const addToSection = (entry, section) => {
        const setter = section === 'commanders' ? setCommanders : section === 'sideboard' ? setSideboard : setMainboard;
        setter(prev => {
            // If already exists, increment quantity (by name)
            const idx = prev.findIndex(c => c.name === entry.name);
            if (idx !== -1) {
                const next = [...prev];
                next[idx] = { ...next[idx], quantity: (next[idx].quantity || 1) + 1 };
                return next;
            }
            return [...prev, { ...entry }];
        });
    };

    const removeFromSection = (idx, section) => {
        const setter = section === 'commanders' ? setCommanders : section === 'sideboard' ? setSideboard : setMainboard;
        setter(prev => prev.filter((_, i) => i !== idx));
    };

    const adjustQty = (idx, section, delta) => {
        const setter = section === 'commanders' ? setCommanders : section === 'sideboard' ? setSideboard : setMainboard;
        setter(prev => {
            const next = [...prev];
            const newQty = (next[idx].quantity || 1) + delta;
            if (newQty <= 0) return prev.filter((_, i) => i !== idx);
            next[idx] = { ...next[idx], quantity: newQty };
            return next;
        });
    };

    const handleSave = async () => {
        setSaving(true);
        const payload = { name, format: 'commander', commanders, mainboard, sideboard };
        try {
            if (deckId) await decks.update(deckId, payload);
            else await decks.create(payload);
            onSaved?.();
            onClose();
        } catch (err) {
            dialog.alert('Failed to save deck', { title: 'Save failed' });
        }
        setSaving(false);
    };

    const totalCount = mainboard.reduce((s, c) => s + (c.quantity || 1), 0)
        + commanders.reduce((s, c) => s + (c.quantity || 1), 0);

    const renderSection = (cards, section, label) => (
        <div className="db-section">
            <strong>{label} ({cards.reduce((s, c) => s + (c.quantity || 1), 0)})</strong>
            {cards.length === 0 && <div className="muted db-empty">Empty</div>}
            {cards.map((c, i) => (
                <div key={i} className="db-card-row">
                    <span className="db-card-qty">
                        <button onClick={() => adjustQty(i, section, -1)}>−</button>
                        {c.quantity || 1}
                        <button onClick={() => adjustQty(i, section, 1)}>+</button>
                    </span>
                    <span className="db-card-name">{c.name}</span>
                    {c.manaCost && <ManaCost cost={c.manaCost} />}
                    {section !== 'commanders' && (
                        <button className="db-promote" title="Make commander" onClick={() => {
                            removeFromSection(i, section);
                            setCommanders(prev => [...prev, { ...c, quantity: 1 }]);
                        }}>★</button>
                    )}
                    {section === 'commanders' && (
                        <button className="db-promote" title="Demote to mainboard" onClick={() => {
                            removeFromSection(i, section);
                            setMainboard(prev => [...prev, { ...c, quantity: 1 }]);
                        }}>↓</button>
                    )}
                    <button className="db-remove" onClick={() => removeFromSection(i, section)}>×</button>
                </div>
            ))}
        </div>
    );

    return (
        <div className="modal-overlay">
            <div className="modal deck-builder-modal">
                <div className="modal-header">
                    <h2>Deck Builder</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <div className="db-name-row">
                    <input type="text" placeholder="Deck name" value={name} onChange={e => setName(e.target.value)} />
                    <span className="muted">{totalCount} cards</span>
                </div>

                <div className="db-body">
                    {/* Left: search/custom cards */}
                    <div className="db-left">
                        <div className="tab-row">
                            <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>Search Cards</button>
                            <button className={tab === 'custom' ? 'active' : ''} onClick={() => setTab('custom')}>Custom Cards</button>
                        </div>

                        {tab === 'search' && (
                            <>
                                <input
                                    type="text"
                                    placeholder="Search Scryfall (e.g. lightning, t:creature, c:red, o:draw)"
                                    value={searchQuery}
                                    onChange={e => handleSearch(e.target.value)}
                                />
                                <div className="db-search-results">
                                    {searchLoading && <div className="muted">Searching...</div>}
                                    {searchResults.map(card => {
                                        const face = card.card_faces?.[0];
                                        const img = card.image_uris?.small || face?.image_uris?.small || '';
                                        return (
                                            <div key={card.id} className="db-search-item">
                                                {img && <img src={img} alt={card.name} />}
                                                <div className="db-search-info">
                                                    <strong>{card.name}</strong>
                                                    <div className="muted">{card.type_line}</div>
                                                </div>
                                                <div className="db-search-actions">
                                                    <button onClick={() => addToSection(scryfallCardToEntry(card), 'mainboard')}>+ Main</button>
                                                    <button onClick={() => addToSection(scryfallCardToEntry(card), 'commanders')}>+ Cmdr</button>
                                                    <button onClick={() => addToSection(scryfallCardToEntry(card), 'sideboard')}>+ SB</button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        )}

                        {tab === 'custom' && (
                            <div className="db-search-results">
                                {savedCustomCards.length === 0 && <div className="muted">No custom cards saved.</div>}
                                {savedCustomCards.map(cc => (
                                    <div key={cc._id} className="db-search-item">
                                        {cc.imageUrl && <img src={cc.imageUrl} alt={cc.name} />}
                                        <div className="db-search-info">
                                            <strong>{cc.name}</strong>
                                            <div className="muted">{cc.typeLine}</div>
                                        </div>
                                        <div className="db-search-actions">
                                            <button onClick={() => addToSection(customToEntry(cc), 'mainboard')}>+ Main</button>
                                            <button onClick={() => addToSection(customToEntry(cc), 'commanders')}>+ Cmdr</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Right: deck contents */}
                    <div className="db-right">
                        {renderSection(commanders, 'commanders', 'Commander')}
                        {renderSection(mainboard, 'mainboard', 'Mainboard')}
                        {renderSection(sideboard, 'sideboard', 'Sideboard')}
                    </div>
                </div>

                <div className="modal-actions">
                    <button onClick={onClose}>Cancel</button>
                    <button onClick={handleSave} disabled={saving} className="primary-btn">
                        {saving ? 'Saving...' : 'Save Deck'}
                    </button>
                </div>
            </div>
        </div>
    );
}
