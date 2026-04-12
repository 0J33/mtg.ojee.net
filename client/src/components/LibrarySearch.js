import React, { useState, useEffect } from 'react';
import socket from '../socket';
import Card from './Card';
import { useEscapeKey } from '../utils';
import { useDialog } from './Dialog';

export default function LibrarySearch({ onClose, onMaximizeCard, sortMode: initialSortMode, viewMode, allZones }) {
    // viewMode: 'library' (default) = show only the library, with tutor actions.
    //           'deck' = show ALL zones grouped by name, alphabetical, read-only overview.
    const isDeckView = viewMode === 'deck';
    // Wrapper around onClose that fires a shuffleLibrary if the user opted in,
    // before closing. Previously the shuffle was tied to each tutor call,
    // which meant "shuffle after" actually shuffled on EVERY pull (wrong) and
    // never on close. Now it only fires once, when the modal closes.
    const [shuffleOnClose, setShuffleOnClose] = useState(false);
    // Grab the latest value via a ref so the close handler (registered once
    // via useEscapeKey) sees the current toggle state.
    const shuffleOnCloseRef = React.useRef(false);
    useEffect(() => { shuffleOnCloseRef.current = shuffleOnClose; }, [shuffleOnClose]);
    const closeWithOptionalShuffle = React.useCallback(() => {
        if (shuffleOnCloseRef.current) {
            socket.emit('shuffleLibrary');
        }
        onClose?.();
    }, [onClose]);
    useEscapeKey(closeWithOptionalShuffle);
    const dialog = useDialog();
    const [library, setLibrary] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [sortMode, setSortMode] = useState(initialSortMode || 'order');
    // Selection state for the "send multiple cards to library position" flow.
    // Users pick cards via a Select button, choose top/bottom and optional
    // random order, then commit — the cards leave the library, get reordered,
    // and come back at the chosen position in the chosen order.
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [selectRandom, setSelectRandom] = useState(false);
    // Battlefield-destination options for tutor: tapped, face-down,
    // +1/+1 counter. Only relevant when destination is battlefield;
    // ignored otherwise. Switches the underlying socket call from
    // `tutorCard` to `tutorCardWithOptions` automatically.
    const [bfTapped, setBfTapped] = useState(false);
    const [bfFaceDown, setBfFaceDown] = useState(false);
    const [bfPlusOne, setBfPlusOne] = useState(false);

    // In deck mode, we need ALL cards including the library — but gameState
    // intentionally strips library contents to prevent cheating. So we still
    // need the viewLibrary socket call, then merge with the other zones the
    // client already has (hand, battlefield, graveyard, exile, command, etc).
    const [deckCards, setDeckCards] = useState([]);
    useEffect(() => {
        // Always fetch library (needed in both modes).
        socket.emit('viewLibrary', (res) => {
            const lib = res?.library || [];
            if (isDeckView && allZones) {
                const OTHER_ZONES = ['commandZone', 'hand', 'battlefield', 'graveyard', 'exile', 'sideboard', 'companions', 'foretell'];
                const cards = [...lib];
                for (const z of OTHER_ZONES) {
                    const arr = allZones[z];
                    if (!Array.isArray(arr)) continue;
                    for (const c of arr) {
                        if (c && !c.hidden) cards.push(c);
                    }
                }
                cards.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                setDeckCards(cards);
            } else {
                setLibrary(lib);
            }
            setLoading(false);
        });
    }, [isDeckView, allZones]);

    const grab = (card, toZone, libraryPosition) => {
        const payload = { instanceId: card.instanceId, toZone };
        if (toZone === 'library' && libraryPosition !== undefined) {
            payload.libraryPosition = libraryPosition;
        }
        // Battlefield destination + any of the option toggles → use the
        // extended handler. Otherwise stick with the cheaper plain `tutorCard`
        // for full backwards-compat.
        const useOptions = toZone === 'battlefield' && (bfTapped || bfFaceDown || bfPlusOne);
        if (useOptions) {
            payload.tapped = bfTapped;
            payload.faceDown = bfFaceDown;
            if (bfPlusOne) payload.counters = { '+1/+1': 1 };
        }
        socket.emit(useOptions ? 'tutorCardWithOptions' : 'tutorCard', payload, (res) => {
            if (res?.success) {
                // Remove from local view
                setLibrary(prev => prev.filter(c => c.instanceId !== card.instanceId));
            }
        });
    };

    // Toggle a card's membership in the select set. Used when the user is
    // queueing up cards to batch-position into the library.
    const toggleSelected = (instanceId) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(instanceId)) next.delete(instanceId);
            else next.add(instanceId);
            return next;
        });
    };

    // Commit selected cards to the top or bottom of the library. Respects
    // the "random order" toggle; otherwise the order is the user-click
    // order (Set iteration preserves insertion order in JS).
    const commitSelectedToLibrary = (position) => {
        if (selectedIds.size === 0) return;
        let ids = Array.from(selectedIds);
        if (selectRandom) {
            // Fisher-Yates in-place shuffle
            for (let i = ids.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [ids[i], ids[j]] = [ids[j], ids[i]];
            }
        }
        socket.emit('batchToLibrary', { instanceIds: ids, position }, (res) => {
            if (res?.error) {
                dialog.alert(res.error, { title: 'Batch to library' });
                return;
            }
            setLibrary(prev => prev.filter(c => !selectedIds.has(c.instanceId)));
            setSelectedIds(new Set());
            setSelectMode(false);
        });
    };

    const sourceList = isDeckView ? deckCards : library;
    const baseList = filter
        ? sourceList.filter(c => {
            const q = filter.toLowerCase();
            return (c.name || '').toLowerCase().includes(q)
                || (c.typeLine || '').toLowerCase().includes(q)
                || (c.oracleText || '').toLowerCase().includes(q);
        })
        : sourceList;

    const filtered = sortMode === 'alphabetical'
        ? [...baseList].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        : baseList;

    // In deck view, group cards by zone for the header labels.
    const ZONE_LABELS = {
        commandZone: 'Command Zone', hand: 'Hand', battlefield: 'Battlefield',
        library: 'Library', graveyard: 'Graveyard', exile: 'Exile',
        sideboard: 'Sideboard', companions: 'Wishboard', foretell: 'Foretell',
    };

    return (
        <div className="modal-overlay">
            <div className="modal library-search-modal">
                <div className="modal-header">
                    <h2>{isDeckView ? `Full Deck (${sourceList.length})` : `Library (${library.length})`}</h2>
                    <button className="close-btn" onClick={closeWithOptionalShuffle}>x</button>
                </div>
                <div className="search-row">
                    <input
                        type="text"
                        placeholder="Filter by name, type, or text"
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        autoFocus
                    />
                    {!isDeckView && (
                        <>
                            <button
                                className={`small-btn ${sortMode === 'alphabetical' ? 'primary-btn' : ''}`}
                                onClick={() => setSortMode(sortMode === 'alphabetical' ? 'order' : 'alphabetical')}
                                title="Toggle alphabetical sort"
                            >A→Z</button>
                            <label className="shuffle-toggle" title="Shuffle the library when you close this modal">
                                <input type="checkbox" checked={shuffleOnClose} onChange={e => setShuffleOnClose(e.target.checked)} />
                                Shuffle after close
                            </label>
                            <button
                                className={`small-btn ${selectMode ? 'primary-btn' : ''}`}
                                onClick={() => { setSelectMode(s => !s); if (selectMode) setSelectedIds(new Set()); }}
                                title="Select multiple cards to batch-send to top/bottom of library"
                            >{selectMode ? 'Exit select' : 'Select…'}</button>
                        </>
                    )}
                </div>
                {/* Tutor-to-battlefield options — library mode only. */}
                {!isDeckView && (
                    <div className="library-bf-options">
                        <span className="muted" style={{ fontSize: 11 }}>When using <strong>Play</strong>:</span>
                        <label><input type="checkbox" checked={bfTapped} onChange={e => setBfTapped(e.target.checked)} /> Tapped</label>
                        <label><input type="checkbox" checked={bfFaceDown} onChange={e => setBfFaceDown(e.target.checked)} /> Face-down</label>
                        <label><input type="checkbox" checked={bfPlusOne} onChange={e => setBfPlusOne(e.target.checked)} /> +1/+1 counter</label>
                    </div>
                )}
                {!isDeckView && selectMode && (
                    <div className="library-select-toolbar">
                        <span>{selectedIds.size} selected</span>
                        <label title="Randomize order before placing">
                            <input type="checkbox" checked={selectRandom} onChange={e => setSelectRandom(e.target.checked)} />
                            Random order
                        </label>
                        <button
                            className="small-btn primary-btn"
                            disabled={selectedIds.size === 0}
                            onClick={() => commitSelectedToLibrary('top')}
                        >→ Top</button>
                        <button
                            className="small-btn primary-btn"
                            disabled={selectedIds.size === 0}
                            onClick={() => commitSelectedToLibrary('bottom')}
                        >→ Bottom</button>
                        <button
                            className="small-btn"
                            disabled={selectedIds.size === 0}
                            onClick={() => setSelectedIds(new Set())}
                        >Clear</button>
                    </div>
                )}
                {loading ? (
                    <p className="muted">Loading...</p>
                ) : isDeckView ? (
                    /* ─── Deck view: flat alphabetical list of every card ── */
                    <div className="library-grid">
                        {filtered.map(card => (
                            <div key={card.instanceId} className="library-card-entry">
                                <Card card={card} onClick={() => onMaximizeCard?.(card)} />
                                <div className="library-card-name muted">{card.name}</div>
                            </div>
                        ))}
                        {filtered.length === 0 && <p className="muted">No matching cards.</p>}
                    </div>
                ) : (
                    /* ─── Library view: tutor actions per card ─────────── */
                    <div className="library-grid">
                        {filtered.map(card => {
                            const isPicked = selectedIds.has(card.instanceId);
                            return (
                                <div
                                    key={card.instanceId}
                                    className={`library-card-entry ${isPicked ? 'selected' : ''}`}
                                >
                                    <Card
                                        card={card}
                                        onClick={() => {
                                            if (selectMode) {
                                                toggleSelected(card.instanceId);
                                            } else {
                                                onMaximizeCard?.(card);
                                            }
                                        }}
                                    />
                                    {!selectMode ? (
                                        <div className="library-card-actions">
                                            <button onClick={() => grab(card, 'hand')} title="To hand">Hand</button>
                                            <button onClick={() => grab(card, 'battlefield')} title="To battlefield">Play</button>
                                            <button onClick={() => grab(card, 'graveyard')} title="To graveyard">GY</button>
                                            <button onClick={() => grab(card, 'exile')} title="To exile">Exile</button>
                                        </div>
                                    ) : (
                                        <div className="library-card-actions">
                                            <button
                                                onClick={() => toggleSelected(card.instanceId)}
                                                className={isPicked ? 'primary-btn' : ''}
                                            >{isPicked ? '✓ Picked' : 'Pick'}</button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {filtered.length === 0 && !loading && <p className="muted">No matching cards.</p>}
                    </div>
                )}
            </div>
        </div>
    );
}
