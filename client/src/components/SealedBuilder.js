import React, { useState, useMemo } from 'react';
import socket from '../socket';

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C', 'M'];
function cardColorKey(card) {
    const colors = card.colors || card.colorIdentity || [];
    if (colors.length === 0) return 'C';
    if (colors.length > 1) return 'M';
    return colors[0];
}

const RARITY_ORDER = { mythic: 0, rare: 1, uncommon: 2, common: 3 };

/**
 * Sealed/draft deck builder. Takes a fixed card pool and lets the player
 * sort cards into main deck vs sideboard, then submit.
 */
export default function SealedBuilder({ pool, onSubmit, mode, onMaximize }) {
    const [main, setMain] = useState([]);
    const [sideboard, setSideboard] = useState([...pool]);
    const [sortBy, setSortBy] = useState('color'); // color, cmc, rarity, type

    const moveToMain = (idx) => {
        const card = sideboard[idx];
        setSideboard(prev => prev.filter((_, i) => i !== idx));
        setMain(prev => [...prev, card]);
    };

    const moveToSideboard = (idx) => {
        const card = main[idx];
        setMain(prev => prev.filter((_, i) => i !== idx));
        setSideboard(prev => [...prev, card]);
    };

    const sortFn = useMemo(() => {
        switch (sortBy) {
            case 'cmc': return (a, b) => {
                const ca = parseInt(a.manaCost?.replace(/[^0-9]/g, '') || '0') || 0;
                const cb = parseInt(b.manaCost?.replace(/[^0-9]/g, '') || '0') || 0;
                return ca - cb || a.name.localeCompare(b.name);
            };
            case 'rarity': return (a, b) => {
                return (RARITY_ORDER[a.rarity] ?? 4) - (RARITY_ORDER[b.rarity] ?? 4) || a.name.localeCompare(b.name);
            };
            case 'type': return (a, b) => (a.typeLine || '').localeCompare(b.typeLine || '');
            default: return (a, b) => {
                const ca = COLOR_ORDER.indexOf(cardColorKey(a));
                const cb = COLOR_ORDER.indexOf(cardColorKey(b));
                return ca - cb || a.name.localeCompare(b.name);
            };
        }
    }, [sortBy]);

    const sortedSideboard = [...sideboard].sort(sortFn);
    const sortedMain = [...main].sort(sortFn);

    const handleSubmit = () => {
        const eventName = mode === 'draft' ? 'draft:submitDeck' : 'sealed:submitDeck';
        socket.emit(eventName, {
            main: main.map(c => ({ ...c, quantity: 1 })),
            sideboard: sideboard.map(c => ({ ...c, quantity: 1 })),
        });
        onSubmit?.();
    };

    const renderCard = (card, idx, onClick) => (
        <div
            key={`${card.scryfallId}-${idx}`}
            className={`sealed-card rarity-${card.rarity || 'common'}`}
            onClick={() => onClick(idx)}
            onContextMenu={(e) => { e.preventDefault(); onMaximize?.(card); }}
            title={`${card.name}\n${card.typeLine}\nRight-click to view`}
        >
            {card.imageUri ? (
                <img src={card.imageUri.replace('/normal/', '/small/')} alt={card.name} />
            ) : (
                <span className="sealed-card-name">{card.name}</span>
            )}
        </div>
    );

    return (
        <div className="sealed-builder">
            <div className="sealed-header">
                <h3>{mode === 'draft' ? 'Draft' : 'Sealed'} Deck Builder</h3>
                <span className="muted">Main: {main.length} · Pool: {sideboard.length} · Click cards to move between main/pool</span>
            </div>

            <div className="sealed-sort-row">
                <span>Sort:</span>
                {['color', 'cmc', 'rarity', 'type'].map(s => (
                    <button key={s} className={`small-btn ${sortBy === s ? 'active' : ''}`} onClick={() => setSortBy(s)}>{s}</button>
                ))}
            </div>

            <div className="sealed-panels">
                <div className="sealed-panel sealed-main">
                    <strong>Main Deck ({main.length})</strong>
                    <div className="sealed-card-grid">
                        {sortedMain.map((c, i) => renderCard(c, main.indexOf(c), moveToSideboard))}
                    </div>
                </div>
                <div className="sealed-panel sealed-pool">
                    <strong>Card Pool ({sideboard.length})</strong>
                    <div className="sealed-card-grid">
                        {sortedSideboard.map((c, i) => renderCard(c, sideboard.indexOf(c), moveToMain))}
                    </div>
                </div>
            </div>

            <div className="sealed-actions">
                <span className={main.length < 40 ? 'muted' : ''}>{main.length < 40 ? `Need ${40 - main.length} more cards (minimum 40)` : 'Deck ready!'}</span>
                <button className="primary-btn" onClick={handleSubmit} disabled={main.length < 40}>
                    Submit Deck
                </button>
            </div>
        </div>
    );
}
