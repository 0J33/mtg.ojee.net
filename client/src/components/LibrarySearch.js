import React, { useState, useEffect } from 'react';
import socket from '../socket';
import Card from './Card';
import { useEscapeKey } from '../utils';

export default function LibrarySearch({ onClose, onMaximizeCard, sortMode: initialSortMode }) {
    useEscapeKey(onClose);
    const [library, setLibrary] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [shuffleAfter, setShuffleAfter] = useState(true);
    const [sortMode, setSortMode] = useState(initialSortMode || 'order');

    useEffect(() => {
        socket.emit('viewLibrary', (res) => {
            if (res?.library) setLibrary(res.library);
            setLoading(false);
        });
    }, []);

    const grab = (card, toZone) => {
        socket.emit('tutorCard', { instanceId: card.instanceId, toZone, shuffle: shuffleAfter }, (res) => {
            if (res?.success) {
                // Remove from local view
                setLibrary(prev => prev.filter(c => c.instanceId !== card.instanceId));
            }
        });
    };

    const baseList = filter
        ? library.filter(c => {
            const q = filter.toLowerCase();
            return (c.name || '').toLowerCase().includes(q)
                || (c.typeLine || '').toLowerCase().includes(q)
                || (c.oracleText || '').toLowerCase().includes(q);
        })
        : library;

    const filtered = sortMode === 'alphabetical'
        ? [...baseList].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        : baseList;

    return (
        <div className="modal-overlay">
            <div className="modal library-search-modal">
                <div className="modal-header">
                    <h2>Search Library ({library.length})</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <div className="search-row">
                    <input
                        type="text"
                        placeholder="Filter by name, type, or text (e.g. creature, lightning, draw a card)"
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        autoFocus
                    />
                    <button
                        className={`small-btn ${sortMode === 'alphabetical' ? 'primary-btn' : ''}`}
                        onClick={() => setSortMode(sortMode === 'alphabetical' ? 'order' : 'alphabetical')}
                        title="Toggle alphabetical sort"
                    >A→Z</button>
                    <label className="shuffle-toggle">
                        <input type="checkbox" checked={shuffleAfter} onChange={e => setShuffleAfter(e.target.checked)} />
                        Shuffle after
                    </label>
                </div>
                {loading ? (
                    <p className="muted">Loading library...</p>
                ) : (
                    <div className="library-grid">
                        {filtered.map(card => (
                            <div key={card.instanceId} className="library-card-entry">
                                <Card card={card} onClick={() => onMaximizeCard?.(card)} />
                                <div className="library-card-actions">
                                    <button onClick={() => grab(card, 'hand')} title="To hand">Hand</button>
                                    <button onClick={() => grab(card, 'battlefield')} title="To battlefield">Play</button>
                                    <button onClick={() => grab(card, 'graveyard')} title="To graveyard">GY</button>
                                    <button onClick={() => grab(card, 'exile')} title="To exile">Exile</button>
                                </div>
                            </div>
                        ))}
                        {filtered.length === 0 && !loading && <p className="muted">No matching cards.</p>}
                    </div>
                )}
            </div>
        </div>
    );
}
