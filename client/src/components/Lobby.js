import React, { useState, useEffect } from 'react';
import socket from '../socket';
import { decks } from '../api';
import DeckImport from './DeckImport';
import DeckViewer from './DeckViewer';
import DeckBuilder from './DeckBuilder';
import CustomCardManager from './CustomCardManager';
import { useDialog } from './Dialog';
import { IconPencil, IconShare } from './Icons';

export default function Lobby({ user, onJoinRoom, onLogout }) {
    // onJoinRoom(code, { asSpectator })
    const dialog = useDialog();
    const [joinCode, setJoinCode] = useState('');
    const [myDecks, setMyDecks] = useState([]);
    const [selectedDeck, setSelectedDeck] = useState(null);
    const [showImport, setShowImport] = useState(false);
    const [viewingDeck, setViewingDeck] = useState(null);
    const [buildingDeck, setBuildingDeck] = useState(null); // null = closed, false = new, deckId = edit
    const [renamingDeck, setRenamingDeck] = useState(null); // deckId currently being renamed
    const [renameValue, setRenameValue] = useState('');
    const [error, setError] = useState('');
    const [socketReady, setSocketReady] = useState(socket.connected);
    const [customCardsOpen, setCustomCardsOpen] = useState(false);

    useEffect(() => {
        decks.list().then(data => {
            if (data.decks) setMyDecks(data.decks);
        });

        const onConnect = () => setSocketReady(true);
        const onDisconnect = () => setSocketReady(false);
        const onError = (err) => setError(`Connection error: ${err.message || err}`);

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('connect_error', onError);

        if (socket.connected) setSocketReady(true);

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('connect_error', onError);
        };
    }, []);

    const createRoom = () => {
        console.log('[createRoom] called, socketReady=', socketReady, 'connected=', socket.connected, 'id=', socket.id);
        if (!socket.connected) {
            setError('Socket not connected. Refresh the page.');
            return;
        }
        setError('Creating room...');
        const timeout = setTimeout(() => {
            console.log('[createRoom] timeout - no response from server');
            setError('Server did not respond. Check console.');
        }, 5000);
        socket.emit('createRoom', { userId: user.id, username: user.username }, (res) => {
            clearTimeout(timeout);
            console.log('[createRoom] callback:', res);
            if (!res) {
                setError('Empty response from server');
                return;
            }
            if (res.error) return setError(res.error);
            setError('');
            // Build a shareable invite link and copy it to the clipboard so the host
            // can just paste it to invite friends. Clipboard writes can fail (http
            // context, permissions, user denied), so the success is best-effort and
            // only logged on failure.
            const inviteUrl = `${window.location.origin}/invite/${res.roomCode}`;
            const copy = async () => {
                try {
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(inviteUrl);
                        return true;
                    }
                } catch (err) {
                    console.warn('[createRoom] clipboard write failed:', err);
                }
                return false;
            };
            copy().then(ok => {
                if (!ok) console.log('[createRoom] invite link (clipboard unavailable):', inviteUrl);
            });
            onJoinRoom(res.roomCode, { asSpectator: false });
        });
    };

    const joinRoom = () => {
        if (!joinCode.trim()) return setError('Enter a room code');
        if (!socketReady) return setError('Connecting to server...');
        setError('');
        socket.emit('joinRoom', { roomCode: joinCode.toUpperCase(), userId: user.id, username: user.username }, (res) => {
            if (res.error) return setError(res.error);
            onJoinRoom(joinCode.toUpperCase(), { asSpectator: false });
        });
    };

    const joinAsSpectator = () => {
        if (!joinCode.trim()) return setError('Enter a room code');
        if (!socketReady) return setError('Connecting to server...');
        setError('');
        socket.emit('joinRoomAsSpectator', { roomCode: joinCode.toUpperCase(), userId: user.id, username: user.username }, (res) => {
            if (res?.error) return setError(res.error);
            onJoinRoom(joinCode.toUpperCase(), { asSpectator: true });
        });
    };

    const handleDeckImported = async (deckData) => {
        const data = await decks.create(deckData);
        if (data.deck) {
            setMyDecks(prev => [data.deck, ...prev]);
            setShowImport(false);
        }
    };

    const handleDeleteDeck = async (id) => {
        await decks.delete(id);
        setMyDecks(prev => prev.filter(d => d._id !== id));
        if (selectedDeck === id) setSelectedDeck(null);
    };

    // Generate a short share code for a deck. The deck snapshot is stored
    // server-side; we just get back a short 8-char code to copy around.
    const handleShareDeck = async (deckId, e) => {
        e?.stopPropagation?.();
        try {
            const res = await decks.share(deckId);
            if (res?.error) { dialog.alert(res.error, { title: 'Share failed' }); return; }
            if (!res?.code) { dialog.alert('No share code returned.', { title: 'Share failed' }); return; }
            try { await navigator.clipboard?.writeText(res.code); } catch (_) {}
            await dialog.alert(
                `Share code for "${res.deckName}":\n\n${res.code}\n\nCopied to clipboard. Share it with a friend — they can import it from the lobby. Codes last 180 days.`,
                { title: 'Deck share' }
            );
        } catch (err) {
            dialog.alert(err.message || 'Share failed', { title: 'Share failed' });
        }
    };

    // Called by DeckImport when the server has already created a deck (e.g.
    // the Share Code tab path). Adds it to the list and closes the import modal.
    const handleDeckCreated = (deck) => {
        if (!deck) return;
        setMyDecks(prev => [deck, ...prev]);
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

    return (
        <div className="lobby-page">
            <div className="lobby-header">
                <h1>MTG Commander</h1>
                <div className="lobby-user">
                    <span>{user.username}</span>
                    <button onClick={onLogout} className="small-btn">Logout</button>
                </div>
            </div>

            <div className="lobby-content">
                <div className="lobby-section">
                    <h2>Play</h2>
                    <div className="lobby-actions">
                        <button onClick={createRoom} className="primary-btn" disabled={!socketReady}>
                        {socketReady ? 'Create Room' : 'Connecting...'}
                    </button>
                        <div className="join-row">
                            <input
                                type="text"
                                placeholder="Room Code"
                                value={joinCode}
                                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                                maxLength={6}
                                onKeyDown={e => e.key === 'Enter' && joinRoom()}
                            />
                            <button onClick={joinRoom}>Join</button>
                            <button onClick={joinAsSpectator} className="small-btn" title="Join without taking a seat — view only, chat only">Spectate</button>
                        </div>
                    </div>
                    {error && <div className="error">{error}</div>}
                </div>

                <div className="lobby-section">
                    <div className="section-header deck-section-header">
                        <h2>My Decks</h2>
                        <div className="deck-section-actions">
                            <button onClick={() => setBuildingDeck(false)} className="small-btn">Build Deck</button>
                            <button onClick={() => setShowImport(true)} className="small-btn">Import</button>
                            <button onClick={() => setCustomCardsOpen(true)} className="small-btn" title="Manage your custom cards (available in any deck)">Custom Cards</button>
                        </div>
                    </div>
                    {myDecks.length === 0 && <p className="muted">No decks yet. Import one to get started.</p>}
                    <div className="deck-list">
                        {myDecks.map(deck => (
                            <div key={deck._id} className="deck-item"
                                onClick={() => renamingDeck !== deck._id && setViewingDeck(deck._id)}>
                                <div className="deck-info">
                                    {renamingDeck === deck._id ? (
                                        <input
                                            type="text"
                                            value={renameValue}
                                            onChange={e => setRenameValue(e.target.value)}
                                            onBlur={commitRename}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') commitRename();
                                                if (e.key === 'Escape') setRenamingDeck(null);
                                            }}
                                            onClick={e => e.stopPropagation()}
                                            autoFocus
                                            className="deck-rename-input"
                                        />
                                    ) : (
                                        <span className="deck-name">{deck.name}</span>
                                    )}
                                    <span className="deck-commander">
                                        {deck.commanders?.map(c => c.name).join(' & ') || 'No commander'}
                                        {deck.notFound?.length > 0 && (
                                            <span className="deck-missing-badge" title={`${deck.notFound.length} missing card(s)`}>
                                                · {deck.notFound.length} missing
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <button className="small-btn" title="Edit deck" onClick={(e) => { e.stopPropagation(); setBuildingDeck(deck._id); }}>Edit</button>
                                <button className="icon-btn" title="Rename" onClick={(e) => startRename(deck, e)}><IconPencil /></button>
                                <button className="icon-btn" title="Share deck (generates share code)" onClick={(e) => handleShareDeck(deck._id, e)}><IconShare /></button>
                                <button className="delete-btn" onClick={(e) => { e.stopPropagation(); handleDeleteDeck(deck._id); }}>x</button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {showImport && <DeckImport onImport={handleDeckImported} onDeckCreated={handleDeckCreated} onClose={() => setShowImport(false)} />}
            {viewingDeck && (
                <DeckViewer
                    deckId={viewingDeck}
                    onClose={() => setViewingDeck(null)}
                    onDelete={handleDeleteDeck}
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
        </div>
    );
}
