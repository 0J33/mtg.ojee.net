import React, { useState, useEffect } from 'react';
import socket from '../socket';
import { decks, imports } from '../api';
import DeckImport from './DeckImport';
import DeckViewer from './DeckViewer';
import DeckBuilder from './DeckBuilder';

export default function Lobby({ user, onJoinRoom, onLogout }) {
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
            onJoinRoom(res.roomCode);
        });
    };

    const joinRoom = () => {
        if (!joinCode.trim()) return setError('Enter a room code');
        if (!socketReady) return setError('Connecting to server...');
        setError('');
        socket.emit('joinRoom', { roomCode: joinCode.toUpperCase(), userId: user.id, username: user.username }, (res) => {
            if (res.error) return setError(res.error);
            onJoinRoom(joinCode.toUpperCase());
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
                                <button className="small-btn" title="Rename" onClick={(e) => startRename(deck, e)}>✎</button>
                                <button className="delete-btn" onClick={(e) => { e.stopPropagation(); handleDeleteDeck(deck._id); }}>x</button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {showImport && <DeckImport onImport={handleDeckImported} onClose={() => setShowImport(false)} />}
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
        </div>
    );
}
