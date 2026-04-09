import React, { useState } from 'react';
import { imports } from '../api';

export default function DeckImport({ onImport, onClose }) {
    const [mode, setMode] = useState('text'); // 'text' or 'moxfield'
    const [text, setText] = useState('');
    const [url, setUrl] = useState('');
    const [deckName, setDeckName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [preview, setPreview] = useState(null);

    const handleImport = async () => {
        setError('');
        setLoading(true);
        try {
            let data;
            if (mode === 'moxfield') {
                data = await imports.moxfield(url);
            } else {
                data = await imports.text(text);
            }

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
        onImport({
            name: deckName || 'Imported Deck',
            format: 'commander',
            commanders: preview.commanders,
            companions: preview.companions,
            mainboard: preview.mainboard,
            sideboard: preview.sideboard,
        });
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Import Deck</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>

                {!preview ? (
                    <>
                        <div className="tab-row">
                            <button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>Paste Text</button>
                            <button className={mode === 'moxfield' ? 'active' : ''} onClick={() => setMode('moxfield')}>Moxfield URL</button>
                        </div>

                        <input
                            type="text"
                            placeholder="Deck name"
                            value={deckName}
                            onChange={e => setDeckName(e.target.value)}
                        />

                        {mode === 'text' ? (
                            <textarea
                                placeholder={`Paste your decklist here...\n\nFormat:\nCommander\n1 Card Name\n\nDeck\n1 Card Name\n1 Card Name`}
                                value={text}
                                onChange={e => setText(e.target.value)}
                                rows={12}
                            />
                        ) : (
                            <input
                                type="text"
                                placeholder="https://moxfield.com/decks/..."
                                value={url}
                                onChange={e => setUrl(e.target.value)}
                            />
                        )}

                        {error && <div className="error">{error}</div>}
                        <button onClick={handleImport} disabled={loading} className="primary-btn">
                            {loading ? 'Importing...' : 'Import'}
                        </button>
                    </>
                ) : (
                    <>
                        <div className="import-preview">
                            <h3>Preview</h3>
                            {preview.commanders?.length > 0 && (
                                <div className="preview-section">
                                    <strong>Commander ({preview.commanders.length})</strong>
                                    {preview.commanders.map((c, i) => <div key={i}>{c.quantity}x {c.name}</div>)}
                                </div>
                            )}
                            <div className="preview-section">
                                <strong>Mainboard ({preview.mainboard?.length || 0})</strong>
                                <div className="preview-scroll">
                                    {preview.mainboard?.map((c, i) => <div key={i}>{c.quantity}x {c.name}</div>)}
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
