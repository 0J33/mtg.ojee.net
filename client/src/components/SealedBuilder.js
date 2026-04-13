import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import socket from '../socket';

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C', 'M', 'L'];
function cardColorKey(card) {
    if ((card.typeLine || '').toLowerCase().includes('basic land')) return 'L';
    const colors = card.colors || card.colorIdentity || [];
    if (colors.length === 0) return 'C';
    if (colors.length > 1) return 'M';
    return colors[0];
}

const RARITY_ORDER = { mythic: 0, rare: 1, uncommon: 2, common: 3, basic: 4 };

// Basic land entries — unlimited supply, always available for limited formats
const BASIC_LANDS = [
    { name: 'Plains',   typeLine: 'Basic Land — Plains',   colors: ['W'], colorIdentity: ['W'], rarity: 'basic', imageUri: '', scryfallId: 'basic-plains', isBasicLand: true, manaCost: '' },
    { name: 'Island',   typeLine: 'Basic Land — Island',   colors: ['U'], colorIdentity: ['U'], rarity: 'basic', imageUri: '', scryfallId: 'basic-island', isBasicLand: true, manaCost: '' },
    { name: 'Swamp',    typeLine: 'Basic Land — Swamp',    colors: ['B'], colorIdentity: ['B'], rarity: 'basic', imageUri: '', scryfallId: 'basic-swamp', isBasicLand: true, manaCost: '' },
    { name: 'Mountain', typeLine: 'Basic Land — Mountain', colors: ['R'], colorIdentity: ['R'], rarity: 'basic', imageUri: '', scryfallId: 'basic-mountain', isBasicLand: true, manaCost: '' },
    { name: 'Forest',   typeLine: 'Basic Land — Forest',   colors: ['G'], colorIdentity: ['G'], rarity: 'basic', imageUri: '', scryfallId: 'basic-forest', isBasicLand: true, manaCost: '' },
];

const MANA_SYMBOLS = { W: '\u2600', U: '\ud83d\udca7', B: '\ud83d\udc80', R: '\ud83d\udd25', G: '\ud83c\udf3f' };

/**
 * Deck builder for sealed/draft. Three panels: Main Deck, Card Pool, Basic Lands.
 * Click cards to move between main/pool. Basic lands have +/- buttons for unlimited supply.
 */
export default function SealedBuilder({ pool, onSubmit, mode, onMaximize }) {
    const [main, setMain] = useState([]);
    const [sideboard, setSideboard] = useState([...pool]);
    const [hover, setHover] = useState(null);
    const [sortBy, setSortBy] = useState('color');
    const [landCounts, setLandCounts] = useState({ Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 });

    const moveToMain = (idx) => {
        const card = sideboard[idx];
        setSideboard(prev => prev.filter((_, i) => i !== idx));
        setMain(prev => [...prev, card]);
    };

    const moveToSideboard = (idx) => {
        const card = main[idx];
        if (card.isBasicLand) {
            // Remove basic land — decrement count instead
            setMain(prev => prev.filter((_, i) => i !== idx));
            setLandCounts(prev => ({ ...prev, [card.name]: Math.max(0, (prev[card.name] || 0) - 1) }));
            return;
        }
        setMain(prev => prev.filter((_, i) => i !== idx));
        setSideboard(prev => [...prev, card]);
    };

    const adjustLand = (landName, delta) => {
        const newCount = Math.max(0, (landCounts[landName] || 0) + delta);
        const oldCount = landCounts[landName] || 0;
        setLandCounts(prev => ({ ...prev, [landName]: newCount }));

        if (delta > 0) {
            const template = BASIC_LANDS.find(l => l.name === landName);
            const newLands = Array.from({ length: delta }, (_, i) => ({
                ...template,
                scryfallId: `basic-${landName.toLowerCase()}-${Date.now()}-${i}`,
            }));
            setMain(prev => [...prev, ...newLands]);
        } else if (delta < 0) {
            // Remove from the end
            let toRemove = Math.min(Math.abs(delta), oldCount);
            setMain(prev => {
                const next = [...prev];
                for (let i = next.length - 1; i >= 0 && toRemove > 0; i--) {
                    if (next[i].isBasicLand && next[i].name === landName) {
                        next.splice(i, 1);
                        toRemove--;
                    }
                }
                return next;
            });
        }
    };

    const totalLands = Object.values(landCounts).reduce((a, b) => a + b, 0);
    const nonLandMain = main.filter(c => !c.isBasicLand);
    const totalMain = main.length;

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
    const sortedMain = [...nonLandMain].sort(sortFn);

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
            onMouseMove={(e) => card.imageUri && setHover({ imageUri: card.imageUri, x: Math.min(e.clientX + 16, window.innerWidth - 340), y: Math.max(10, Math.min(e.clientY - 40, window.innerHeight - 460)) })}
            onMouseLeave={() => setHover(null)}
            title={`${card.name}\n${card.typeLine}`}
        >
            {card.imageUri ? (
                <img src={card.imageUri.replace('/normal/', '/small/')} alt={card.name} />
            ) : (
                <span className="sealed-card-name">{card.name}</span>
            )}
        </div>
    );

    // Color distribution for the mana curve hint
    const colorDist = {};
    for (const c of nonLandMain) {
        const key = cardColorKey(c);
        colorDist[key] = (colorDist[key] || 0) + 1;
    }

    return (
        <div className="sealed-builder">
            <div className="sealed-header">
                <h3>{mode === 'draft' ? 'Draft' : 'Sealed'} Deck Builder</h3>
                <span className="muted">
                    Spells: {nonLandMain.length} · Lands: {totalLands} · Total: {totalMain} / 40 min
                </span>
            </div>

            <div className="sealed-sort-row">
                <span>Sort:</span>
                {['color', 'cmc', 'rarity', 'type'].map(s => (
                    <button key={s} className={`small-btn ${sortBy === s ? 'active' : ''}`} onClick={() => setSortBy(s)}>{s}</button>
                ))}
            </div>

            <div className="sealed-panels">
                {/* Main Deck */}
                <div className="sealed-panel sealed-main">
                    <strong>Main Deck ({totalMain})</strong>
                    <div className="sealed-card-grid">
                        {sortedMain.map((c, i) => renderCard(c, main.indexOf(c), moveToSideboard))}
                    </div>
                </div>

                {/* Card Pool */}
                <div className="sealed-panel sealed-pool">
                    <strong>Card Pool ({sideboard.length})</strong>
                    <div className="sealed-card-grid">
                        {sortedSideboard.map((c, i) => renderCard(c, sideboard.indexOf(c), moveToMain))}
                    </div>
                </div>
            </div>

            {/* Basic Lands — unlimited supply */}
            <div className="sealed-lands">
                <strong>Basic Lands ({totalLands})</strong>
                <div className="sealed-land-row">
                    {BASIC_LANDS.map(land => {
                        const count = landCounts[land.name] || 0;
                        const color = land.colorIdentity[0];
                        return (
                            <div key={land.name} className="sealed-land-btn">
                                <button className="small-btn" onClick={() => adjustLand(land.name, -1)} disabled={count === 0}>-</button>
                                <span className={`sealed-land-label mana-${color}`}>
                                    {land.name} ({count})
                                </span>
                                <button className="small-btn" onClick={() => adjustLand(land.name, 1)}>+</button>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="sealed-actions">
                <span className={totalMain < 40 ? 'muted' : 'sealed-ready'}>
                    {totalMain < 40 ? `Need ${40 - totalMain} more cards (minimum 40)` : 'Deck ready!'}
                </span>
                <button className="primary-btn" onClick={handleSubmit} disabled={totalMain < 40}>
                    Submit Deck
                </button>
            </div>

            {hover && hover.imageUri && createPortal(
                <div className="card-zoom" style={{ position: 'fixed', left: hover.x, top: hover.y, zIndex: 3000, pointerEvents: 'none' }}>
                    <img src={hover.imageUri} alt="" />
                </div>,
                document.body
            )}
        </div>
    );
}
