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

export default function CounterModal({ card, onAdd, onClose }) {
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

    const handleAdd = () => {
        const trimmed = name.trim();
        if (trimmed && !allPresets.includes(trimmed)) {
            const next = [...customs, trimmed];
            setCustoms(next);
            saveCustomCounters(next);
        }
        onAdd(trimmed, value);
    };

    return createPortal(
        <div className="modal-overlay">
            <div className="modal counter-modal">
                <div className="modal-header">
                    <h3>Add Counter to {card?.name || 'card'}</h3>
                    <button className="close-btn" onClick={onClose}>x</button>
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
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    />
                    <input
                        type="number"
                        value={value}
                        onChange={e => setValue(parseInt(e.target.value) || 0)}
                        min={0}
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    />
                </div>
                <div className="counter-actions">
                    <button onClick={saveAsPreset} className="small-btn" title="Save name as a preset without adding">Save preset</button>
                    <button onClick={handleAdd} className="primary-btn">Add</button>
                </div>
            </div>
        </div>,
        document.body
    );
}
