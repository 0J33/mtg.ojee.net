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
    const [tokens, setTokens] = useState([]);
    const [importedFrom, setImportedFrom] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [savedCustomCards, setSavedCustomCards] = useState([]);
    const [tab, setTab] = useState('search'); // search, custom, tokens, deck
    const [saving, setSaving] = useState(false);
    const [tokenQuery, setTokenQuery] = useState('');
    const [tokenResults, setTokenResults] = useState([]);
    const [tokenLoading, setTokenLoading] = useState(false);
    const [skinPicker, setSkinPicker] = useState(null); // { idx, section, cardName }
    const [skinPrints, setSkinPrints] = useState([]);
    const [skinLoading, setSkinLoading] = useState(false);
    const [skinUrlInput, setSkinUrlInput] = useState('');
    const debounceRef = useRef(null);
    const tokenDebounceRef = useRef(null);

    useEffect(() => {
        if (deckId) {
            decks.get(deckId).then(data => {
                if (data.deck) {
                    setName(data.deck.name);
                    setCommanders(data.deck.commanders || []);
                    setMainboard(data.deck.mainboard || []);
                    setSideboard(data.deck.sideboard || []);
                    setTokens(data.deck.tokens || []);
                    setImportedFrom(data.deck.importedFrom || '');
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

    const handleTokenSearch = (q) => {
        setTokenQuery(q);
        if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
        if (q.length < 2) { setTokenResults([]); return; }
        tokenDebounceRef.current = setTimeout(async () => {
            setTokenLoading(true);
            const data = await scryfall.search(`t:token ${q}`);
            setTokenResults(data.data || []);
            setTokenLoading(false);
        }, 300);
    };

    const addToken = (card) => {
        const entry = scryfallCardToEntry(card);
        if (tokens.some(t => t.name === entry.name)) return; // dedup by name
        setTokens(prev => [...prev, entry]);
    };

    const removeToken = (idx) => setTokens(prev => prev.filter((_, i) => i !== idx));

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
        // Stable identity for the origin-aware edit fanout: editing this
        // custom card will update every deck entry with matching
        // (customCardOriginId, customCardOwnerId).
        customCardOriginId: cc.originId,
        customCardOwnerId: cc.ownerId,
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

    const toggleFoil = (idx, section) => {
        const setter = section === 'commanders' ? setCommanders : section === 'sideboard' ? setSideboard : setMainboard;
        setter(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], foil: !next[idx].foil };
            return next;
        });
    };

    const openSkinPicker = async (idx, section) => {
        const card = (section === 'commanders' ? commanders : section === 'sideboard' ? sideboard : mainboard)[idx];
        if (!card?.name) return;
        setSkinPicker({ idx, section, cardName: card.name, currentImageUri: card.imageUri, skinUrl: card.skinUrl });
        setSkinUrlInput('');
        setSkinLoading(true);
        setSkinPrints([]);
        try {
            const data = await scryfall.prints(card.name);
            setSkinPrints(data.data || []);
        } catch (_) {}
        setSkinLoading(false);
    };

    const applySkin = (url) => {
        if (!skinPicker) return;
        const { idx, section } = skinPicker;
        const setter = section === 'commanders' ? setCommanders : section === 'sideboard' ? setSideboard : setMainboard;
        setter(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], skinUrl: url || null };
            return next;
        });
        setSkinPicker(null);
    };

    const handleSave = async () => {
        setSaving(true);
        const payload = { name, format: 'commander', commanders, mainboard, sideboard, tokens, importedFrom: importedFrom || null };
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
                    <button
                        className={`db-foil-btn ${c.foil ? 'active' : ''}`}
                        title={c.foil ? 'Remove foil' : 'Make foil'}
                        onClick={() => toggleFoil(i, section)}
                    >✦</button>
                    {!c.isCustom && c.scryfallId && (
                        <button
                            className={`db-skin-btn ${c.skinUrl ? 'active' : ''}`}
                            title={c.skinUrl ? 'Change / remove alternate art' : 'Pick alternate art'}
                            onClick={() => openSkinPicker(i, section)}
                        >🎨</button>
                    )}
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
                    <button className="close-btn" onClick={onClose}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
                <div className="db-name-row">
                    <input type="text" placeholder="Deck name" value={name} onChange={e => setName(e.target.value)} />
                    <span className="muted">{totalCount} cards</span>
                </div>
                <div className="db-source-row">
                    <input type="text" placeholder="Moxfield / source URL (optional)" value={importedFrom} onChange={e => setImportedFrom(e.target.value)} className="db-source-input" />
                </div>

                <div className="db-body">
                    {/* Left: search/custom cards */}
                    <div className="db-left">
                        <div className="tab-row">
                            <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>Search</button>
                            <button className={tab === 'custom' ? 'active' : ''} onClick={() => setTab('custom')}>Custom</button>
                            <button className={tab === 'tokens' ? 'active' : ''} onClick={() => setTab('tokens')}>Tokens ({tokens.length})</button>
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

                        {tab === 'tokens' && (
                            <>
                                <input
                                    type="text"
                                    placeholder="Search tokens (e.g. soldier, treasure, food)"
                                    value={tokenQuery}
                                    onChange={e => handleTokenSearch(e.target.value)}
                                />
                                {tokens.length > 0 && (
                                    <div className="db-token-list">
                                        <strong>Deck tokens ({tokens.length})</strong>
                                        {tokens.map((t, i) => (
                                            <div key={i} className="db-search-item">
                                                {t.imageUri && <img src={t.imageUri.replace('/normal/', '/small/')} alt={t.name} />}
                                                <div className="db-search-info"><strong>{t.name}</strong></div>
                                                <button className="delete-btn" onClick={() => removeToken(i)} title="Remove token">
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="db-search-results">
                                    {tokenLoading && <div className="muted">Searching...</div>}
                                    {tokenResults.map(card => {
                                        const face = card.card_faces?.[0];
                                        const img = card.image_uris?.small || face?.image_uris?.small || '';
                                        const already = tokens.some(t => t.name === card.name);
                                        return (
                                            <div key={card.id} className="db-search-item">
                                                {img && <img src={img} alt={card.name} />}
                                                <div className="db-search-info">
                                                    <strong>{card.name}</strong>
                                                    <div className="muted">{card.type_line}</div>
                                                </div>
                                                <div className="db-search-actions">
                                                    <button onClick={() => addToken(card)} disabled={already}>{already ? 'Added' : '+ Token'}</button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
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

            {skinPicker && (
                <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSkinPicker(null); }}>
                    <div className="modal db-skin-modal">
                        <div className="modal-header">
                            <h3>Alternate art · {skinPicker.cardName}</h3>
                            <button className="close-btn" onClick={() => setSkinPicker(null)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                        </div>
                        <div className="db-skin-actions">
                            {skinPicker.skinUrl && (
                                <button className="small-btn" onClick={() => applySkin(null)}>Reset to default</button>
                            )}
                        </div>
                        {skinLoading && <div className="muted">Loading printings...</div>}
                        {!skinLoading && skinPrints.length > 0 && (
                            <div className="card-skin-gallery">
                                {skinPrints.map(art => (
                                    <div
                                        key={art.id}
                                        className={`card-skin-thumb ${skinPicker.skinUrl === art.imageUri ? 'active' : ''}`}
                                        onClick={() => applySkin(art.imageUri)}
                                        title={`${art.set} (${art.setCode})`}
                                    >
                                        <img src={art.imageUri?.replace('/normal/', '/small/')} alt={art.set} />
                                        <span className="card-skin-set">{art.setCode}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="db-skin-url-row">
                            <input type="text" placeholder="Or paste any image URL" value={skinUrlInput} onChange={e => setSkinUrlInput(e.target.value)} />
                            <button className="small-btn" onClick={() => skinUrlInput && applySkin(skinUrlInput.trim())} disabled={!skinUrlInput.trim()}>Apply</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
