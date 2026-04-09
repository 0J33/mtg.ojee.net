import React, { useState, useEffect } from 'react';
import socket from '../socket';
import { decks, imports } from '../api';
import DeckImport from './DeckImport';

export default function Lobby({ user, onJoinRoom, onLogout }) {
    const [joinCode, setJoinCode] = useState('');
    const [myDecks, setMyDecks] = useState([]);
    const [selectedDeck, setSelectedDeck] = useState(null);
    const [showImport, setShowImport] = useState(false);
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
        if (!socketReady) return setError('Connecting to server...');
        setError('');
        socket.emit('createRoom', { userId: user.id, username: user.username }, (res) => {
            if (res.error) return setError(res.error);
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
                    <div className="section-header">
                        <h2>My Decks</h2>
                        <button onClick={() => setShowImport(true)} className="small-btn">Import Deck</button>
                    </div>
                    {myDecks.length === 0 && <p className="muted">No decks yet. Import one to get started.</p>}
                    <div className="deck-list">
                        {myDecks.map(deck => (
                            <div key={deck._id} className={`deck-item ${selectedDeck === deck._id ? 'selected' : ''}`}
                                onClick={() => setSelectedDeck(deck._id)}>
                                <div className="deck-info">
                                    <span className="deck-name">{deck.name}</span>
                                    <span className="deck-commander">
                                        {deck.commanders?.map(c => c.name).join(' & ') || 'No commander'}
                                    </span>
                                </div>
                                <button className="delete-btn" onClick={(e) => { e.stopPropagation(); handleDeleteDeck(deck._id); }}>x</button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {showImport && <DeckImport onImport={handleDeckImported} onClose={() => setShowImport(false)} />}
        </div>
    );
}
