import React, { useState, useEffect } from 'react';
import socket from '../socket';
import Card from './Card';
import { useEscapeKey } from '../utils';
import { useDialog } from './Dialog';

export default function LibrarySearch({ onClose, onMaximizeCard, sortMode: initialSortMode }) {
    useEscapeKey(onClose);
    const dialog = useDialog();
    const [library, setLibrary] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    // Shuffle-after is now OFF by default — most tutor effects shouldn't
    // reshuffle the library. Leaving this on by default was causing people
    // to lose track order after pulling a specific card.
    const [shuffleAfter, setShuffleAfter] = useState(false);
    const [sortMode, setSortMode] = useState(initialSortMode || 'order');

    useEffect(() => {
        socket.emit('viewLibrary', (res) => {
            if (res?.library) setLibrary(res.library);
            setLoading(false);
        });
    }, []);

    const grab = (card, toZone, libraryPosition) => {
        const payload = { instanceId: card.instanceId, toZone, shuffle: shuffleAfter };
        if (toZone === 'library' && libraryPosition !== undefined) {
            payload.libraryPosition = libraryPosition;
        }
        socket.emit('tutorCard', payload, (res) => {
            if (res?.success) {
                // Remove from local view
                setLibrary(prev => prev.filter(c => c.instanceId !== card.instanceId));
            }
        });
    };

    // Put a card back into the library at a chosen position. Prompts for
    // "top", "bottom", or a numeric index (0 = top). Used to set up effects
    // that let you arrange cards on top of your draw pile.
    const grabToLibrary = async (card) => {
        const input = await dialog.prompt(
            `Place "${card.name}" in your library at which position?\n0 = top, ${library.length - 1} = bottom, or type "top" / "bottom".`,
            '0',
            { title: 'Position in library' }
        );
        if (input === null) return;
        const s = String(input).trim().toLowerCase();
        let pos;
        if (s === 'top') pos = 0;
        else if (s === 'bottom') pos = library.length - 1;
        else {
            pos = parseInt(s, 10);
            if (isNaN(pos)) return;
        }
        grab(card, 'library', pos);
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
                                    <button onClick={() => grabToLibrary(card)} title="Place back in library at a chosen position">Lib…</button>
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
