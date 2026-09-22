import React, { useState, useEffect, useCallback } from 'react';
import socket from '../socket';
import { decks } from '../api';
import DeckImport from './DeckImport';
import DeckViewer from './DeckViewer';
import DeckBuilder from './DeckBuilder';
import CustomCardManager from './CustomCardManager';
import Changelog from './Changelog';
import { useDialog } from './Dialog';
import Icon, { IconPencil, IconShare } from './Icons';
import { VERSION } from '../version';
import '../home.css';

const DISCLAIMER = 'Magic: The Gathering, MTG, and all associated names, logos, card images, and symbols are trademarks of Wizards of the Coast LLC. This is an unofficial fan project, not produced, endorsed, or supported by Wizards of the Coast. Card data provided by Scryfall. Deck import powered by Moxfield\'s API; Moxfield is not affiliated with this project.';

const FORMATS = [
    ['commander', 'Commander'], ['brawl', 'Brawl'], ['oathbreaker', 'Oathbreaker'], ['standard', 'Standard'],
    ['modern', 'Modern'], ['legacy', 'Legacy'], ['vintage', 'Vintage'], ['pauper', 'Pauper'], ['free', 'Freeform'],
];
const FORMAT_NAME = Object.fromEntries([...FORMATS, ['draft', 'Draft']]);
const IDLE_CLOSE_MIN = 60; // server closes a table after an hour with nobody at it

// Scryfall image -> the art-only crop of the same card (server does the same for seats).
const artCrop = (url) => (url && /cards\.scryfall\.io\//.test(url)
    ? url.replace(/\/(small|normal|large|png|border_crop)\//, '/art_crop/').replace(/\.png(\?|$)/, '.jpg$1')
    : null);

const minutesSince = (t) => Math.max(0, Math.round((Date.now() - t) / 60000));
function ago(t) {
    const m = minutesSince(t);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    return `${h} h ago`;
}

function tableState(t) {
    if (!t.online) return 'is-quiet';
    if (t.draft) return 'is-drafting';
    if (t.started) return 'is-playing';
    return '';
}

function tableStatus(t) {
    if (!t.online) {
        const left = Math.max(1, IDLE_CLOSE_MIN - minutesSince(t.idleSince));
        return `Nobody here right now. Closes in about ${left} min unless someone sits down.`;
    }
    if (t.draft) return t.draft === 'sealed' ? 'Building sealed pools' : 'Drafting';
    if (t.mulligan) return 'Mulligans: everyone is deciding on their opening hand';
    if (t.started) return t.turnOf ? `Turn: ${t.turnOf}` : 'Game under way';
    if (t.seats.length >= t.maxPlayers) return 'Full: watch or wait for a seat';
    return 'Waiting for players';
}

// Taken seats, then a few open ones; a long row of empty rings says less
// than "5 open seats".
function Seats({ table }) {
    const seats = table.seats.slice(0, 8);
    const open = Math.max(0, table.maxPlayers - table.seats.length);
    const empty = open > 0 ? Math.min(open, Math.max(1, 4 - seats.length)) : 0;
    const moreOpen = open - empty;
    return (
        <ol className="mh-seats" aria-label={`${table.seats.length} of ${table.maxPlayers} seats taken`}>
            {seats.map((s, i) => (
                <li
                    key={`${s.username}-${i}`}
                    className={`mh-seat ${s.online ? '' : 'is-away'} ${s.out ? 'is-out' : ''}`}
                    style={s.art ? { backgroundImage: `url(${s.art})` } : undefined}
                    title={`${s.username}${s.online ? '' : ' (away)'}${s.out ? ' (out)' : ''}`}
                >
                    {!s.art && s.username.slice(0, 1).toUpperCase()}
                </li>
            ))}
            {Array.from({ length: empty }, (_, i) => <li key={`e${i}`} className="mh-seat is-empty" aria-hidden="true" />)}
            {table.seats.length > 8 && <li className="mh-seat-more">+{table.seats.length - 8}</li>}
            {moreOpen > 0 && <li className="mh-seat-more">{moreOpen} more open</li>}
        </ol>
    );
}

function TableSlip({ table, onSit, onWatch }) {
    const full = table.seats.length >= table.maxPlayers;
    return (
        <li className={`mh-slip mh-table ${tableState(table)} ${table.youAreIn ? 'is-yours' : ''}`}>
            <span className="mh-pin"><Icon name="pin" size={18} /></span>
            <h3>
                {table.youAreIn ? 'Your table' : `${table.host}'s table`}
                <span className="mh-format"> · {FORMAT_NAME[table.format] || table.format}</span>
            </h3>
            <p className="mh-table-status">{tableStatus(table)}</p>
            <Seats table={table} />
            <p className="mh-seat-names">{table.seats.map((s) => s.username).join(', ')}</p>
            <div className="mh-table-foot">
                <span className="mh-table-meta">
                    <span className="mh-table-code" title="Table code">{table.code}</span>
                    {table.private && <span className="mh-lock" title="Invite only: hidden from the board"><Icon name="lock" size={13} /> invite only</span>}
                    {table.spectators > 0 && <span title="Watching"><Icon name="eye" size={14} /> {table.spectators}</span>}
                    <span>{ago(table.createdAt)}</span>
                </span>
                <span className="mh-table-actions">
                    {table.youAreIn ? (
                        <button className="mh-primary" onClick={() => onSit(table.code)}>Rejoin</button>
                    ) : (
                        <>
                            {!full && <button className="mh-primary" onClick={() => onSit(table.code)}>Sit down</button>}
                            <button className="mh-btn" onClick={() => onWatch(table.code)}>Watch</button>
                        </>
                    )}
                </span>
            </div>
        </li>
    );
}

export default function Lobby({ user, onJoinRoom, onLogout, pendingShareCode, onShareConsumed }) {
    // onJoinRoom(code, { asSpectator })
    const dialog = useDialog();
    const [joinCode, setJoinCode] = useState('');
    const [tables, setTables] = useState(null);
    const [newFormat, setNewFormat] = useState('commander');
    const [newPrivate, setNewPrivate] = useState(false);
    const [myDecks, setMyDecks] = useState(null);
    const [showImport, setShowImport] = useState(false);
    const [viewingDeck, setViewingDeck] = useState(null);
    const [changelogOpen, setChangelogOpen] = useState(false);
    const [buildingDeck, setBuildingDeck] = useState(null); // null = closed, false = new, deckId = edit
    const [renamingDeck, setRenamingDeck] = useState(null); // deckId currently being renamed
    const [renameValue, setRenameValue] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [socketReady, setSocketReady] = useState(socket.connected);
    const [customCardsOpen, setCustomCardsOpen] = useState(false);
    // "Closes in about N min" and "N min ago" are worked out at render, and a
    // quiet board sends no updates, so re-render every half minute.
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 30000);
        return () => clearInterval(id);
    }, []);

    // Auto-open import modal with share code pre-filled when arriving via /share/CODE
    useEffect(() => {
        if (pendingShareCode) {
            setShowImport(true);
            onShareConsumed?.();
        }
    }, [pendingShareCode, onShareConsumed]);

    useEffect(() => {
        decks.list().then(data => setMyDecks(data.decks || []));
    }, []);

    // Live list of open tables: subscribe while this screen is up, again on
    // every reconnect.
    useEffect(() => {
        const subscribe = () => socket.emit('lobby:subscribe', { userId: user.id });
        const onConnect = () => { setSocketReady(true); setError(''); subscribe(); };
        const onDisconnect = () => setSocketReady(false);
        const onError = () => setError("Can't reach the table server. Retrying…");
        socket.on('lobby:rooms', setTables);
        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('connect_error', onError);
        if (socket.connected) { setSocketReady(true); subscribe(); }
        return () => {
            socket.emit('lobby:unsubscribe');
            socket.off('lobby:rooms', setTables);
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('connect_error', onError);
        };
    }, [user.id]);

    const createRoom = () => {
        if (!socket.connected) return setError("Not connected to the table server yet. Give it a second.");
        setError('');
        setNotice('Setting up the table…');
        const timeout = setTimeout(() => setNotice(''), 5000);
        // The invite link is copied so the host can paste it straight into the
        // call. The code only exists once the server answers, but Safari only
        // allows a copy during the click, so the clipboard write starts now
        // with the link still on its way.
        let giveUrl = () => {};
        let refuseUrl = () => {};
        const url = new Promise((resolve, reject) => { giveUrl = resolve; refuseUrl = reject; });
        let copying = null;
        try {
            if (window.ClipboardItem && navigator.clipboard?.write) {
                copying = navigator.clipboard.write([
                    new window.ClipboardItem({ 'text/plain': url.then((u) => new Blob([u], { type: 'text/plain' })) }),
                ]);
                copying.catch(() => {});
            }
        } catch (_) {
            copying = null;
        }
        socket.emit('createRoom', { userId: user.id, username: user.username, settings: { format: newFormat, private: newPrivate } }, async (res) => {
            clearTimeout(timeout);
            setNotice('');
            if (!res || res.error) {
                refuseUrl(new Error('no table'));
                return setError(res?.error || 'The server did not answer. Try again.');
            }
            const inviteUrl = `${window.location.origin}/invite/${res.roomCode}`;
            giveUrl(inviteUrl);
            let copied = false;
            try {
                if (copying) await copying;
                else await navigator.clipboard.writeText(inviteUrl);
                copied = true;
            } catch (_) {
                try { await navigator.clipboard.writeText(inviteUrl); copied = true; } catch (__) { /* shown by hand at the table */ }
            }
            onJoinRoom(res.roomCode, { asSpectator: false, invite: { url: inviteUrl, copied } });
        });
    };

    const sit = useCallback((code) => {
        const roomCode = String(code || '').trim().toUpperCase();
        if (!roomCode) return setError('Type a table code first.');
        if (!socketReady) return setError('Still connecting to the table server…');
        setError('');
        socket.emit('joinRoom', { roomCode, userId: user.id, username: user.username }, (res) => {
            if (res.error) return setError(res.error === 'Room not found' ? `No open table has the code ${roomCode}.` : res.error);
            onJoinRoom(roomCode, { asSpectator: false, state: res.state });
        });
    }, [socketReady, user, onJoinRoom]);

    const watch = useCallback((code) => {
        const roomCode = String(code || '').trim().toUpperCase();
        if (!roomCode) return setError('Type a table code first.');
        if (!socketReady) return setError('Still connecting to the table server…');
        setError('');
        socket.emit('joinRoomAsSpectator', { roomCode, userId: user.id, username: user.username }, (res) => {
            if (res?.error) return setError(res.error === 'Room not found' ? `No open table has the code ${roomCode}.` : res.error);
            onJoinRoom(roomCode, { asSpectator: true, state: res.state });
        });
    }, [socketReady, user, onJoinRoom]);

    const handleDeckImported = async (deckData) => {
        const data = await decks.create(deckData);
        if (data.deck) {
            setMyDecks(prev => [data.deck, ...(prev || [])]);
            setShowImport(false);
        }
    };

    const removeDeck = async (id) => {
        await decks.delete(id);
        setMyDecks(prev => (prev || []).filter(d => d._id !== id));
    };

    // The list's delete asks first; the deck viewer asks on its own.
    const handleDeleteDeck = async (id) => {
        const deck = (myDecks || []).find(d => d._id === id);
        const ok = await dialog.confirm(`Delete "${deck?.name || 'this deck'}"? This can't be undone.`, { title: 'Delete deck', danger: true, confirmLabel: 'Delete' });
        if (ok) await removeDeck(id);
    };

    // Generate a short share code for a deck. The deck snapshot is stored
    // server-side; we just get back a short 8-char code to copy around.
    const handleShareDeck = async (deckId, e) => {
        e?.stopPropagation?.();
        try {
            const res = await decks.share(deckId);
            if (res?.error) { dialog.alert(res.error, { title: 'Share failed' }); return; }
            if (!res?.code) { dialog.alert('No share code returned.', { title: 'Share failed' }); return; }
            const shareUrl = `${window.location.origin}/share/${res.code}`;
            try { await navigator.clipboard?.writeText(shareUrl); } catch (_) {}
            await dialog.alert(
                `Share link for "${res.deckName}":\n\n${shareUrl}\n\nCopied to clipboard. Opening the link auto-imports the deck. Codes last 180 days.`,
                { title: 'Deck shared' }
            );
        } catch (err) {
            dialog.alert(err.message || 'Share failed', { title: 'Share failed' });
        }
    };

    // Called by DeckImport when the server has already created a deck (e.g.
    // the Share Code tab path). Adds it to the list and closes the import modal.
    const handleDeckCreated = (deck) => {
        if (!deck) return;
        setMyDecks(prev => [deck, ...(prev || [])]);
        setShowImport(false);
    };

    const startRename = (deck, e) => {
        e.stopPropagation();
        setRenamingDeck(deck._id);
        setRenameValue(deck.name);
    };

    const commitRename = async () => {
        if (!renamingDeck || !renameValue.trim()) {
            setRenamingDeck(null);
            return;
        }
        const data = await decks.update(renamingDeck, { name: renameValue.trim() });
        if (data.deck) {
            setMyDecks(prev => prev.map(d => d._id === renamingDeck ? { ...d, name: data.deck.name } : d));
        }
        setRenamingDeck(null);
    };

    const list = tables || [];
    const others = list.filter(t => !t.youAreIn);
    const playing = list.reduce((n, t) => n + t.seats.filter(s => s.online).length, 0);

    return (
        <div className="mh-home">
            <header className="mh-bar">
                <div className="mh-brand">
                    <img src="/mtg-logo.svg?v=2" alt="" />
                    <span className="mh-brand-name">mtg.ojee.net</span>
                    <button className="mh-version" onClick={() => setChangelogOpen(true)} title="What's new">v{VERSION}</button>
                </div>
                <form className="mh-code" onSubmit={(e) => { e.preventDefault(); sit(joinCode); }}>
                    <label htmlFor="mh-code-input" className="mh-sr">Table code</label>
                    <input
                        id="mh-code-input"
                        className="mh-input"
                        placeholder="Table code"
                        value={joinCode}
                        onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                        maxLength={6}
                        autoComplete="off"
                    />
                    <button type="submit" className="mh-btn">Sit down</button>
                    <button type="button" className="mh-btn" onClick={() => watch(joinCode)} title="Watch without a seat: see every hand, chat only">Watch</button>
                </form>
                <div className="mh-me">
                    <Icon name="user" size={18} />
                    <span>{user.username}</span>
                    <button className="mh-icon-btn" onClick={onLogout} title="Sign out (of dnd.ojee.net too)" aria-label="Sign out">
                        <Icon name="logout" size={18} />
                    </button>
                </div>
            </header>

            <main className="mh-main">
                <section className="mh-board" aria-labelledby="mh-tables-title">
                    <div className="mh-board-head">
                        <h2 id="mh-tables-title">Tables</h2>
                        <p className="mh-board-meta" aria-live="polite">
                            {tables === null ? (socketReady ? 'Looking for open tables…' : 'Connecting…')
                                : list.length === 0 ? 'Nobody has a table open.'
                                    : <><b>{list.length}</b> open · {playing} playing</>}
                        </p>
                    </div>
                    {(error || notice) && <p className={error ? 'mh-error' : 'mh-notice'} role={error ? 'alert' : 'status'} style={{ marginTop: 10 }}>{error || notice}</p>}
                    <ul className="mh-slips">
                        <li className="mh-slip mh-new">
                            <span className="mh-pin"><Icon name="pin" size={18} /></span>
                            <h3>Start a table</h3>
                            <p>The invite link is copied as soon as it's ready, so you can paste it straight into your call.</p>
                            <label className="mh-field">
                                <span>Format</span>
                                <select className="mh-select" value={newFormat} onChange={e => setNewFormat(e.target.value)}>
                                    {FORMATS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                                </select>
                            </label>
                            <label className="mh-check">
                                <input type="checkbox" checked={newPrivate} onChange={e => setNewPrivate(e.target.checked)} />
                                <span>Invite only: keep it off this board</span>
                            </label>
                            <button className="mh-primary" onClick={createRoom} disabled={!socketReady}>
                                <Icon name="plus" size={16} /> {socketReady ? 'Start a table' : 'Connecting…'}
                            </button>
                        </li>
                        {list.map(t => <TableSlip key={t.code} table={t} onSit={sit} onWatch={watch} />)}
                    </ul>
                    {tables !== null && others.length === 0 && (
                        <p className="mh-empty">No one else has a table open right now. Start one and send the link, or ask a friend for their code.</p>
                    )}
                </section>

                <aside className="mh-decks" aria-labelledby="mh-decks-title">
                    <div className="mh-decks-head">
                        <h2 id="mh-decks-title">Your decks</h2>
                        {myDecks?.length > 0 && <span className="mh-decks-count">{myDecks.length}</span>}
                    </div>
                    <div className="mh-deck-tools">
                        <button className="mh-btn" onClick={() => setBuildingDeck(false)}><Icon name="plus" size={14} /> Build</button>
                        <button className="mh-btn" onClick={() => setShowImport(true)}>Import</button>
                        <button className="mh-btn" onClick={() => setCustomCardsOpen(true)} title="Custom cards you can use in any deck">Custom cards</button>
                    </div>
                    {myDecks?.length === 0 && (
                        <p className="mh-decks-empty">No decks yet. Import one from a Moxfield link or a pasted list, or build one card by card.</p>
                    )}
                    <ul className="mh-deck-list">
                        {(myDecks || []).map(deck => {
                            const art = artCrop(deck.commanders?.[0]?.imageUri);
                            return (
                                <li key={deck._id} className="mh-deck" onClick={() => renamingDeck !== deck._id && setViewingDeck(deck._id)}>
                                    <span className="mh-deck-art" style={art ? { backgroundImage: `url(${art})` } : undefined} aria-hidden="true">
                                        {!art && (deck.name || '?').slice(0, 1).toUpperCase()}
                                    </span>
                                    <span className="mh-deck-text">
                                        {renamingDeck === deck._id ? (
                                            <input
                                                className="mh-input mh-deck-rename"
                                                value={renameValue}
                                                onChange={e => setRenameValue(e.target.value)}
                                                onBlur={commitRename}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') commitRename();
                                                    if (e.key === 'Escape') setRenamingDeck(null);
                                                }}
                                                onClick={e => e.stopPropagation()}
                                                aria-label="Deck name"
                                                autoFocus
                                            />
                                        ) : (
                                            <button className="mh-deck-name" onClick={(e) => { e.stopPropagation(); setViewingDeck(deck._id); }}>{deck.name}</button>
                                        )}
                                        <span className="mh-deck-sub">
                                            {deck.commanders?.map(c => c.name).join(' & ') || FORMAT_NAME[deck.format] || 'No commander'}
                                            {deck.sharedByUsername && <> · from {deck.sharedByUsername}</>}
                                            {deck.notFound?.length > 0 && <span className="is-missing"> · {deck.notFound.length} missing</span>}
                                        </span>
                                    </span>
                                    <span className="mh-deck-actions" onClick={e => e.stopPropagation()}>
                                        <button className="mh-btn" title="Edit the cards" onClick={() => setBuildingDeck(deck._id)}>Edit</button>
                                        <button className="mh-icon-btn" title="Rename" aria-label={`Rename ${deck.name}`} onClick={(e) => startRename(deck, e)}><IconPencil size={16} /></button>
                                        <button className="mh-icon-btn" title="Share (copies a link)" aria-label={`Share ${deck.name}`} onClick={(e) => handleShareDeck(deck._id, e)}><IconShare size={16} /></button>
                                        <button className="mh-icon-btn is-danger" title="Delete" aria-label={`Delete ${deck.name}`} onClick={() => handleDeleteDeck(deck._id)}><Icon name="trash" size={16} /></button>
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </aside>
            </main>

            <footer className="mh-foot">
                <p className="mh-disclaimer">{DISCLAIMER}</p>
            </footer>

            {showImport && <DeckImport onImport={handleDeckImported} onDeckCreated={handleDeckCreated} onClose={() => setShowImport(false)} initialShareCode={pendingShareCode} />}
            {viewingDeck && (
                <DeckViewer
                    deckId={viewingDeck}
                    onClose={() => setViewingDeck(null)}
                    onDelete={removeDeck}
                    onEdit={(id) => { setViewingDeck(null); setBuildingDeck(id); }}
                />
            )}
            {buildingDeck !== null && (
                <DeckBuilder
                    deckId={buildingDeck || null}
                    onClose={() => setBuildingDeck(null)}
                    onSaved={async () => {
                        const data = await decks.list();
                        if (data.decks) setMyDecks(data.decks);
                    }}
                />
            )}
            {customCardsOpen && (
                <CustomCardManager onClose={() => setCustomCardsOpen(false)} />
            )}
            {changelogOpen && <Changelog onClose={() => setChangelogOpen(false)} />}
        </div>
    );
}
