import React, { useState, useEffect } from 'react';
import { imports } from '../api';
import { useEscapeKey } from '../utils';

export default function DeckImport({ onImport, onClose }) {
    useEscapeKey(onClose);
    const [text, setText] = useState('');
    const [deckName, setDeckName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [preview, setPreview] = useState(null);
    const [commanderIds, setCommanderIds] = useState(new Set()); // scryfallIds chosen as commanders

    // Cards that can be commanders: legendary creatures, legendary vehicles,
    // planeswalkers with "can be your commander" text
    const isPossibleCommander = (c) => {
        const t = c.typeLine || '';
        const o = c.oracleText || '';
        if (!/Legendary/i.test(t)) return false;
        if (/Creature/i.test(t)) return true;
        if (/Vehicle/i.test(t)) return true;
        if (/can be your commander/i.test(o)) return true;
        return false;
    };

    // Auto-detect possible commanders
    useEffect(() => {
        if (!preview || preview.commanders?.length > 0) return;
        const legendaries = (preview.mainboard || []).filter(isPossibleCommander);
        if (legendaries.length > 0 && legendaries.length <= 2) {
            setCommanderIds(new Set(legendaries.map(c => c.scryfallId)));
        }
    }, [preview]);

    const handleImport = async () => {
        setError('');
        setLoading(true);
        try {
            const data = await imports.text(text);
            if (data.error) {
                setError(data.error);
                setLoading(false);
                return;
            }
            setPreview(data);
        } catch (err) {
            setError('Import failed');
        }
        setLoading(false);
    };

    const handleSave = () => {
        if (!preview) return;
        // Move selected commander cards from mainboard to commanders
        const allMain = [...(preview.mainboard || []), ...(preview.commanders || [])];
        const commanders = allMain.filter(c => commanderIds.has(c.scryfallId));
        const mainboard = allMain.filter(c => !commanderIds.has(c.scryfallId));
        // Normalize notFound to an array of strings
        const notFound = (preview.notFound || []).map(n => typeof n === 'string' ? n : (n?.name || ''));
        onImport({
            name: deckName || 'Imported Deck',
            format: 'commander',
            commanders,
            companions: preview.companions || [],
            mainboard,
            sideboard: preview.sideboard || [],
            notFound,
        });
    };

    const toggleCommander = (scryfallId) => {
        setCommanderIds(prev => {
            const next = new Set(prev);
            if (next.has(scryfallId)) next.delete(scryfallId);
            else next.add(scryfallId);
            return next;
        });
    };

    // Combine commanders + mainboard for display so user can re-select
    const allCards = preview ? [...(preview.commanders || []), ...(preview.mainboard || [])] : [];
    const legendaries = allCards.filter(isPossibleCommander);
    const otherCards = allCards.filter(c => !legendaries.includes(c));

    return (
        <div className="modal-overlay">
            <div className="modal">
                <div className="modal-header">
                    <h2>Import Deck</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>

                {!preview ? (
                    <>
                        <div className="tab-row">
                            <button className="active">Paste Text</button>
                            <button className="disabled-tab" disabled title="Temporarily disabled">Moxfield URL</button>
                        </div>

                        <input
                            type="text"
                            placeholder="Deck name"
                            value={deckName}
                            onChange={e => setDeckName(e.target.value)}
                        />

                        <p className="muted import-instructions">
                            On Moxfield, open your deck → click <strong>"Copy for Moxfield"</strong> (More → Export → Copy for Moxfield)
                            and paste the result below. Each line should look like <code>1 Card Name (SET) 123</code>.
                            You'll pick your commander on the next step.
                        </p>

                        <textarea
                            placeholder={`1 Sol Ring (C21) 263\n1 Arcane Signet (PIP) 224\n31 Island (J22) 103\n...`}
                            value={text}
                            onChange={e => setText(e.target.value)}
                            rows={12}
                        />

                        {error && <div className="error">{error}</div>}
                        <button onClick={handleImport} disabled={loading || !text.trim()} className="primary-btn">
                            {loading ? 'Importing...' : 'Import'}
                        </button>
                    </>
                ) : (
                    <>
                        <div className="import-preview">
                            <h3>Select Commander(s)</h3>
                            <p className="muted">Click legendary cards to mark them as commanders. Selected: {commanderIds.size}</p>

                            {legendaries.length > 0 ? (
                                <div className="preview-section">
                                    <strong>Possible Commanders ({legendaries.length})</strong>
                                    <div className="commander-picks">
                                        {legendaries.map((c, i) => (
                                            <div
                                                key={i}
                                                className={`commander-pick ${commanderIds.has(c.scryfallId) ? 'selected' : ''}`}
                                                onClick={() => toggleCommander(c.scryfallId)}
                                            >
                                                {c.imageUri && <img src={c.imageUri.replace('/normal/', '/small/')} alt={c.name} />}
                                                <span>{c.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <p className="muted">No legendary creatures detected.</p>
                            )}

                            <div className="preview-section">
                                <strong>Other Cards ({otherCards.length})</strong>
                                <div className="preview-scroll">
                                    {otherCards.map((c, i) => <div key={i}>{c.quantity}x {c.name}</div>)}
                                </div>
                            </div>
                            {preview.notFound?.length > 0 && (
                                <div className="preview-section error">
                                    <strong>Not Found ({preview.notFound.length})</strong>
                                    {preview.notFound.map((n, i) => <div key={i}>{typeof n === 'string' ? n : n.name}</div>)}
                                </div>
                            )}
                        </div>
                        <div className="modal-actions">
                            <button onClick={() => setPreview(null)}>Back</button>
                            <button onClick={handleSave} className="primary-btn">Save Deck</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
