import React, { useState, useEffect } from 'react';
import { imports, decks } from '../api';
import { useEscapeKey } from '../utils';

export default function DeckImport({ onImport, onDeckCreated, onClose }) {
    useEscapeKey(onClose);
    // 'paste' = paste a text decklist, 'share' = enter an 8-char share code.
    // These live on the same modal instead of two separate lobby buttons so
    // users only have one "Import" entry point to learn.
    const [mode, setMode] = useState('paste');
    const [text, setText] = useState('');
    const [deckName, setDeckName] = useState('');
    const [shareCode, setShareCode] = useState('');
    const [moxfieldUrl, setMoxfieldUrl] = useState('');
    // Copy = new CustomCard records owned by me, fully independent.
    // Link = keep the original author's ownership; their edits propagate to
    // my deck automatically.
    const [customCardMode, setCustomCardMode] = useState('copy');
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

    // One-click clipboard paste — removes the "focus textarea + Ctrl+V" step
    // from the Moxfield flow. navigator.clipboard.readText requires a user
    // gesture (the button click counts) and a secure context (https). Failure
    // is handled by showing an inline error that nudges the user to paste
    // manually instead.
    const handlePasteFromClipboard = async () => {
        setError('');
        try {
            if (!navigator.clipboard?.readText) {
                setError('Clipboard read not supported in this browser — paste manually.');
                return;
            }
            const clip = await navigator.clipboard.readText();
            if (!clip || !clip.trim()) {
                setError('Clipboard is empty — copy a decklist first.');
                return;
            }
            setText(clip);
        } catch (err) {
            // Usually "permission denied" or "document not focused" — both of
            // which mean the user needs to click/grant permission themselves.
            setError('Couldn\'t read clipboard. Click inside the page first, or paste manually.');
        }
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

    // Moxfield URL import — server-side fetch goes through moxfieldClient.js,
    // which enforces the rate limit + secret UA handling. Returns the same
    // shape as the text import (commanders/companions/mainboard/sideboard/notFound)
    // so we feed it into the existing preview/commander-pick flow.
    const handleMoxfieldImport = async () => {
        setError('');
        const url = moxfieldUrl.trim();
        if (!url) { setError('Enter a Moxfield deck URL'); return; }
        if (!/moxfield\.com\/decks\//.test(url)) {
            setError('That doesn\'t look like a Moxfield deck URL');
            return;
        }
        setLoading(true);
        try {
            const data = await imports.moxfield(url);
            if (data.error) {
                setError(data.error);
                setLoading(false);
                return;
            }
            // Auto-fill deck name from the URL slug if user hasn't set one
            if (!deckName) {
                const slug = url.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/)?.[1];
                if (slug) setDeckName(`Moxfield ${slug.slice(0, 8)}`);
            }
            setPreview(data);
        } catch (err) {
            setError(err.message || 'Import failed');
        }
        setLoading(false);
    };

    // Share-code import: server has already stored the full deck snapshot, so
    // we just POST the code and it returns the created deck. No commander-pick
    // step, no preview — the share already has everything resolved.
    const handleShareImport = async () => {
        setError('');
        const code = shareCode.trim().toUpperCase();
        if (!code) { setError('Enter a share code'); return; }
        setLoading(true);
        try {
            const res = await decks.importShare(code, customCardMode);
            if (res?.error) { setError(res.error); setLoading(false); return; }
            if (res?.deck) {
                onDeckCreated?.(res.deck);
            }
        } catch (err) {
            setError(err.message || 'Import failed');
        }
        setLoading(false);
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
                            <button className={mode === 'paste' ? 'active' : ''} onClick={() => { setMode('paste'); setError(''); }}>Paste Text</button>
                            <button className={mode === 'share' ? 'active' : ''} onClick={() => { setMode('share'); setError(''); }}>Share Code</button>
                            <button className={mode === 'moxfield' ? 'active' : ''} onClick={() => { setMode('moxfield'); setError(''); }}>Moxfield URL</button>
                        </div>

                        {mode === 'paste' && (
                            <>
                                <input
                                    type="text"
                                    placeholder="Deck name"
                                    value={deckName}
                                    onChange={e => setDeckName(e.target.value)}
                                />

                                <p className="muted import-instructions">
                                    On Moxfield, open your deck → More → Export → <strong>Copy as plain text</strong>.
                                    Plain text is the most reliable format (fewer missing cards than "Copy for Moxfield").
                                    Paste the result below. You'll pick your commander on the next step.
                                </p>

                                <div className="paste-row">
                                    <button
                                        type="button"
                                        className="small-btn"
                                        onClick={handlePasteFromClipboard}
                                        title="Read the decklist from your clipboard"
                                    >
                                        Paste from clipboard
                                    </button>
                                    {text && (
                                        <button
                                            type="button"
                                            className="small-btn"
                                            onClick={() => setText('')}
                                            title="Clear the text area"
                                        >Clear</button>
                                    )}
                                </div>
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
                        )}

                        {mode === 'share' && (
                            <>
                                <p className="muted import-instructions">
                                    Enter a share code from a friend to import their deck, including any custom cards they used.
                                    Share codes are 8 characters and last 180 days.
                                </p>
                                <input
                                    type="text"
                                    placeholder="e.g. AB3KMQ78"
                                    value={shareCode}
                                    onChange={e => setShareCode(e.target.value.toUpperCase())}
                                    maxLength={12}
                                    autoFocus
                                    onKeyDown={e => e.key === 'Enter' && handleShareImport()}
                                />
                                <div className="custom-card-mode-picker">
                                    <strong>If the deck contains custom cards:</strong>
                                    <label>
                                        <input
                                            type="radio"
                                            name="customCardMode"
                                            value="copy"
                                            checked={customCardMode === 'copy'}
                                            onChange={() => setCustomCardMode('copy')}
                                        />
                                        <span>
                                            <strong>Copy</strong> — add to my custom cards, I can edit freely. No link to the original author.
                                        </span>
                                    </label>
                                    <label>
                                        <input
                                            type="radio"
                                            name="customCardMode"
                                            value="link"
                                            checked={customCardMode === 'link'}
                                            onChange={() => setCustomCardMode('link')}
                                        />
                                        <span>
                                            <strong>Link</strong> — use the original author's version. Their future edits show up automatically in this deck.
                                        </span>
                                    </label>
                                </div>
                                {error && <div className="error">{error}</div>}
                                <button onClick={handleShareImport} disabled={loading || !shareCode.trim()} className="primary-btn">
                                    {loading ? 'Importing...' : 'Import from Share Code'}
                                </button>
                            </>
                        )}

                        {mode === 'moxfield' && (
                            <>
                                <input
                                    type="text"
                                    placeholder="Deck name (optional)"
                                    value={deckName}
                                    onChange={e => setDeckName(e.target.value)}
                                />
                                <p className="muted import-instructions">
                                    Paste a public Moxfield deck URL — e.g.
                                    <code> https://www.moxfield.com/decks/abc123XYZ</code>.
                                    The server fetches the deck through Moxfield's official API
                                    (rate-limited, so back-to-back imports may take a few seconds).
                                </p>
                                <input
                                    type="text"
                                    placeholder="https://www.moxfield.com/decks/..."
                                    value={moxfieldUrl}
                                    onChange={e => setMoxfieldUrl(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleMoxfieldImport()}
                                    autoFocus
                                />
                                {error && <div className="error">{error}</div>}
                                <button onClick={handleMoxfieldImport} disabled={loading || !moxfieldUrl.trim()} className="primary-btn">
                                    {loading ? 'Importing...' : 'Import from Moxfield'}
                                </button>
                            </>
                        )}
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
