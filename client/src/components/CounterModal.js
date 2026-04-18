import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeKey } from '../utils';

export const BUILTIN_COUNTER_PRESETS = ['+1/+1', '-1/-1', 'loyalty', 'charge', 'shield', 'lore', 'time'];
const CUSTOM_COUNTER_KEY = 'mtg_customCounters';

export function loadCustomCounters() {
    try {
        const raw = localStorage.getItem(CUSTOM_COUNTER_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}
export function saveCustomCounters(arr) {
    try { localStorage.setItem(CUSTOM_COUNTER_KEY, JSON.stringify(arr)); } catch {}
}

// Props:
//   card: the card being edited (or first selected card for multi-select)
//   onApply(name, value, mode): mode is 'add' (delta) or 'set' (absolute).
//     The caller decides how to apply it (single card or all selected).
//   multiCount: number of cards this will apply to (for UI label).
export default function CounterModal({ card, onApply, onClose, multiCount }) {
    useEscapeKey(onClose);
    const [name, setName] = useState('+1/+1');
    const [value, setValue] = useState(1);
    const [customs, setCustoms] = useState([]);

    useEffect(() => { setCustoms(loadCustomCounters()); }, []);

    const allPresets = [...BUILTIN_COUNTER_PRESETS, ...customs];

    const saveAsPreset = () => {
        const trimmed = name.trim();
        if (!trimmed || allPresets.includes(trimmed)) return;
        const next = [...customs, trimmed];
        setCustoms(next);
        saveCustomCounters(next);
    };

    const removeCustom = (preset) => {
        const next = customs.filter(c => c !== preset);
        setCustoms(next);
        saveCustomCounters(next);
        if (name === preset) setName('+1/+1');
    };

    const doApply = (mode) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (!allPresets.includes(trimmed)) {
            const next = [...customs, trimmed];
            setCustoms(next);
            saveCustomCounters(next);
        }
        onApply(trimmed, value, mode);
    };

    return createPortal(
        <div className="modal-overlay counter-modal-overlay">
            <div className="modal counter-modal">
                <div className="modal-header">
                    <h3>Counters{multiCount > 1 ? ` · ${multiCount} cards` : ` · ${card?.name || 'card'}`}</h3>
                    <button className="close-btn" onClick={onClose}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
                <div className="counter-presets">
                    {BUILTIN_COUNTER_PRESETS.map(p => (
                        <button key={p} className={name === p ? 'active' : ''} onClick={() => setName(p)}>{p}</button>
                    ))}
                    {customs.map(p => (
                        <span key={p} className="counter-preset-custom">
                            <button className={name === p ? 'active' : ''} onClick={() => setName(p)}>{p}</button>
                            <button className="counter-preset-remove" title="Remove preset" onClick={() => removeCustom(p)}>×</button>
                        </span>
                    ))}
                </div>
                <div className="counter-custom">
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Counter name (typed names auto-save as presets)"
                        onKeyDown={e => e.key === 'Enter' && doApply('add')}
                    />
                    <input
                        type="number"
                        value={value}
                        onChange={e => setValue(parseInt(e.target.value) || 0)}
                        onKeyDown={e => e.key === 'Enter' && doApply('add')}
                    />
                </div>
                <div className="counter-actions">
                    <button onClick={saveAsPreset} className="small-btn" title="Save name as a preset without applying">Save preset</button>
                    <button onClick={() => doApply('set')} className="small-btn" title="Replace current counter value with this">Set</button>
                    <button onClick={() => doApply('add')} className="primary-btn" title="Add this amount to the current counter (negative subtracts)">Add</button>
                </div>
            </div>
        </div>,
        document.body
    );
}
