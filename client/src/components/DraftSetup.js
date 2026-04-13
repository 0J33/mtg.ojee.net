import React, { useState, useEffect } from 'react';
import { draft } from '../api';
import { useEscapeKey } from '../utils';
import socket from '../socket';

/**
 * Modal for configuring and starting a sealed or draft event.
 * Host picks a set, mode (sealed/draft), and pack count/timer.
 */
export default function DraftSetup({ onClose, isHost, mode: initialMode }) {
    useEscapeKey(onClose);
    const [sets, setSets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedSet, setSelectedSet] = useState(null);
    const [mode, setMode] = useState(initialMode || 'sealed'); // sealed or draft
    const [packCount, setPackCount] = useState(mode === 'draft' ? 3 : 6);
    const [pickTime, setPickTime] = useState(60);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        draft.sets().then(data => {
            setSets(data.sets || []);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    useEffect(() => {
        setPackCount(mode === 'draft' ? 3 : 6);
    }, [mode]);

    const filtered = sets.filter(s => {
        if (!search) return true;
        const q = search.toLowerCase();
        return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q);
    });

    const handleStart = () => {
        console.log('[DraftSetup] handleStart', { selectedSet: selectedSet?.code, isHost, mode });
        if (!selectedSet || !isHost) { console.log('[DraftSetup] blocked — no set or not host'); return; }
        setStarting(true);
        setError('');
        if (mode === 'sealed') {
            socket.emit('sealed:start', { setCode: selectedSet.code, packCount }, (res) => {
                setStarting(false);
                if (res?.error) setError(res.error);
                else onClose();
            });
        } else {
            console.log('[DraftSetup] emitting draft:start', { setCode: selectedSet.code, packsPerPlayer: packCount, pickTimeSec: pickTime, socketConnected: socket.connected });
            socket.emit('draft:start', { setCode: selectedSet.code, packsPerPlayer: packCount, pickTimeSec: pickTime }, (res) => {
                setStarting(false);
                if (res?.error) setError(res.error);
                else onClose();
            });
        }
    };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal draft-setup-modal">
                <div className="modal-header">
                    <h2>{mode === 'sealed' ? 'Sealed' : 'Draft'} Setup</h2>
                    <button className="close-btn" onClick={onClose}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <div className="draft-mode-picker">
                    <button className={`small-btn ${mode === 'sealed' ? 'active' : ''}`} onClick={() => setMode('sealed')}>Sealed</button>
                    <button className={`small-btn ${mode === 'draft' ? 'active' : ''}`} onClick={() => setMode('draft')}>Draft</button>
                </div>

                <div className="draft-set-search">
                    <input
                        type="text"
                        placeholder="Search sets..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        autoFocus
                    />
                </div>

                <div className="draft-set-list">
                    {loading && <div className="muted">Loading sets...</div>}
                    {!loading && filtered.length === 0 && <div className="muted">No sets found.</div>}
                    {filtered.slice(0, 50).map(s => (
                        <div
                            key={s.code}
                            className={`draft-set-item ${selectedSet?.code === s.code ? 'selected' : ''}`}
                            onClick={() => setSelectedSet(s)}
                        >
                            {s.iconUri && <img src={s.iconUri} alt="" className="draft-set-icon" />}
                            <div className="draft-set-info">
                                <strong>{s.name}</strong>
                                <span className="muted">{s.code.toUpperCase()} · {s.releaseDate} · {s.type}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {selectedSet && (
                    <div className="draft-selected-set">
                        Selected: <strong>{selectedSet.name}</strong> ({selectedSet.code.toUpperCase()})
                    </div>
                )}

                <div className="draft-options">
                    <label>
                        Packs per player:
                        <input type="number" min={1} max={12} value={packCount} onChange={e => setPackCount(parseInt(e.target.value) || 3)} />
                    </label>
                    {mode === 'draft' && (
                        <label>
                            Seconds per pick:
                            <select value={pickTime} onChange={e => setPickTime(parseInt(e.target.value))}>
                                <option value={30}>30s</option>
                                <option value={45}>45s</option>
                                <option value={60}>60s</option>
                                <option value={90}>90s</option>
                                <option value={0}>No limit</option>
                            </select>
                        </label>
                    )}
                </div>

                {error && <div className="draft-error">{error}</div>}

                <div className="modal-actions">
                    <button onClick={onClose}>Cancel</button>
                    <button
                        className="primary-btn"
                        onClick={handleStart}
                        disabled={!selectedSet || !isHost || starting}
                    >
                        {starting ? 'Generating packs (this may take a moment)...' : !selectedSet ? 'Select a set first' : `Start ${mode === 'sealed' ? 'Sealed' : 'Draft'}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
