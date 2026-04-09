import React, { useState, useCallback } from 'react';
import socket from '../socket';
import { decks } from '../api';
import PlayerZone from './PlayerZone';
import CardSearch from './CardSearch';
import CardMaximized from './CardMaximized';
import DrawingCanvas from './DrawingCanvas';
import ScryModal from './ScryModal';
import { PHASES } from '../utils';

export default function GameBoard({ user, gameState, roomCode, onLeave, revealedCard, onDismissReveal }) {
    const [showSearch, setShowSearch] = useState(null); // null, 'token', 'add'
    const [maximizedCard, setMaximizedCard] = useState(null);
    const [drawingEnabled, setDrawingEnabled] = useState(false);
    const [showScry, setShowScry] = useState(false);
    const [scryCards, setScryCards] = useState([]);
    const [showDeckPicker, setShowDeckPicker] = useState(false);
    const [myDecks, setMyDecks] = useState([]);
    const [showPlayerMenu, setShowPlayerMenu] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    const [customCardModal, setCustomCardModal] = useState(false);
    const [bgModal, setBgModal] = useState(false);

    const me = gameState.players.find(p => p.userId === user.id);
    const isHost = gameState.hostId === user.id;
    const turnPlayer = gameState.players[gameState.turnIndex];

    const handleLoadDeck = async () => {
        const data = await decks.list();
        if (data.decks) setMyDecks(data.decks);
        setShowDeckPicker(true);
    };

    const handleSelectDeck = async (deckId) => {
        const data = await decks.get(deckId);
        if (data.deck) {
            socket.emit('loadDeck', { deckData: data.deck }, () => {});
        }
        setShowDeckPicker(false);
    };

    const handleScry = () => {
        const count = parseInt(prompt('How many cards to scry?', '1'));
        if (!count || count < 1) return;
        socket.emit('scry', { count }, (res) => {
            if (res?.cards) {
                setScryCards(res.cards);
                setShowScry(true);
            }
        });
    };

    const handleMulligan = () => {
        socket.emit('mulligan', {}, () => {});
    };

    const handleSetPhase = (phase) => {
        socket.emit('setPhase', { phase });
    };

    const handleNextTurn = () => {
        socket.emit('nextTurn');
    };

    const handleUntapAll = () => {
        socket.emit('untapAll');
    };

    const handleUndo = () => {
        socket.emit('undo');
    };

    const handlePlayerContextMenu = (e, player) => {
        e.preventDefault();
        setShowPlayerMenu({
            x: e.clientX, y: e.clientY,
            playerId: player.userId,
            playerName: player.username,
        });
    };

    const handleDesignation = (playerId, designation, value) => {
        socket.emit('setDesignation', { targetPlayerId: playerId, designation, value });
        setShowPlayerMenu(null);
    };

    const handleCommanderDamage = (fromId, toId) => {
        const target = gameState.players.find(p => p.userId === toId);
        const current = target?.commanderDamageFrom?.[fromId] || 0;
        const val = parseInt(prompt(`Commander damage from ${gameState.players.find(p => p.userId === fromId)?.username}? Current: ${current}`, current.toString()));
        if (!isNaN(val)) socket.emit('setCommanderDamage', { fromPlayerId: fromId, toPlayerId: toId, damage: val });
    };

    const handleAddCounter = (playerId) => {
        const name = prompt('Counter name (e.g. poison, energy):');
        if (!name) return;
        const target = gameState.players.find(p => p.userId === playerId);
        const current = target?.counters?.[name] || 0;
        const val = parseInt(prompt(`Value for ${name}?`, (current + 1).toString()));
        if (!isNaN(val)) socket.emit('setPlayerCounter', { targetPlayerId: playerId, counter: name, value: val });
    };

    return (
        <div className="game-board">
            {/* Top bar */}
            <div className="game-topbar">
                <div className="topbar-left">
                    <span className="room-code">Room: {roomCode || gameState.roomCode}</span>
                    <span className="turn-info">
                        Turn: <strong>{turnPlayer?.username || '?'}</strong>
                    </span>
                </div>
                <div className="phase-tracker">
                    {PHASES.map(p => (
                        <button
                            key={p.id}
                            className={`phase-btn ${gameState.currentPhase === p.id ? 'active' : ''}`}
                            onClick={() => handleSetPhase(p.id)}
                            title={p.label}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
                <div className="topbar-right">
                    <button onClick={handleNextTurn} className="small-btn">Next Turn</button>
                    <button onClick={handleUntapAll} className="small-btn">Untap All</button>
                    <button onClick={handleUndo} className="small-btn">Undo</button>
                    <button onClick={() => setShowSearch('token')} className="small-btn">Tokens</button>
                    <button onClick={() => setShowSearch('add')} className="small-btn">Search</button>
                    <button onClick={handleMulligan} className="small-btn">Mulligan</button>
                    <button onClick={handleLoadDeck} className="small-btn">Load Deck</button>
                    <button onClick={() => setCustomCardModal(true)} className="small-btn">Custom</button>
                    <button onClick={() => setBgModal(true)} className="small-btn">BG</button>
                    <button onClick={() => socket.emit('drawCards', { count: 1 })} className="small-btn">Draw</button>
                    {isHost && !gameState.started && <button onClick={() => socket.emit('startGame')} className="primary-btn">Start Game</button>}
                    <button onClick={onLeave} className="small-btn danger">Leave</button>
                </div>
            </div>

            {/* Player zones */}
            <div className={`player-zones players-${gameState.players.length}`}>
                {gameState.players.map(player => (
                    <div key={player.userId} className="player-zone-wrapper" onContextMenu={(e) => handlePlayerContextMenu(e, player)}>
                        <PlayerZone
                            player={player}
                            isOwner={player.userId === user.id}
                            userId={user.id}
                            allPlayers={gameState.players}
                            onMaximizeCard={setMaximizedCard}
                            onScry={player.userId === user.id ? handleScry : undefined}
                        />
                    </div>
                ))}
            </div>

            {/* Drawing overlay */}
            <DrawingCanvas
                drawings={gameState.drawings}
                enabled={drawingEnabled}
                onToggle={() => setDrawingEnabled(!drawingEnabled)}
            />

            {/* Modals */}
            {showSearch && <CardSearch mode={showSearch} onClose={() => setShowSearch(null)} />}
            {maximizedCard && <CardMaximized card={maximizedCard} onClose={() => setMaximizedCard(null)} />}
            {revealedCard && (
                <div className="modal-overlay" onClick={onDismissReveal}>
                    <div className="card-revealed" onClick={e => e.stopPropagation()}>
                        <h3>{revealedCard.revealedBy} reveals:</h3>
                        <CardMaximized card={revealedCard} onClose={onDismissReveal} />
                    </div>
                </div>
            )}
            {showScry && <ScryModal cards={scryCards} onClose={() => setShowScry(false)} />}
            {showDeckPicker && (
                <div className="modal-overlay" onClick={() => setShowDeckPicker(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Select Deck</h2>
                            <button className="close-btn" onClick={() => setShowDeckPicker(false)}>x</button>
                        </div>
                        {myDecks.length === 0 ? (
                            <p className="muted">No decks saved. Import one from the lobby first.</p>
                        ) : (
                            <div className="deck-list">
                                {myDecks.map(d => (
                                    <div key={d._id} className="deck-item" onClick={() => handleSelectDeck(d._id)}>
                                        <span className="deck-name">{d.name}</span>
                                        <span className="deck-commander">{d.commanders?.map(c => c.name).join(' & ')}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Player context menu */}
            {showPlayerMenu && (
                <div className="context-menu" style={{ left: showPlayerMenu.x, top: showPlayerMenu.y }}>
                    <div className="context-item" onClick={() => { handleAddCounter(showPlayerMenu.playerId); setShowPlayerMenu(null); }}>
                        Add Counter
                    </div>
                    <div className="context-item" onClick={() => { handleDesignation(showPlayerMenu.playerId, 'monarch', true); }}>
                        Give Monarch
                    </div>
                    <div className="context-item" onClick={() => { handleDesignation(showPlayerMenu.playerId, 'initiative', true); }}>
                        Give Initiative
                    </div>
                    <div className="context-item" onClick={() => { handleDesignation(showPlayerMenu.playerId, 'citysBlessing', true); }}>
                        City's Blessing
                    </div>
                    <div className="context-divider" />
                    {gameState.players.filter(p => p.userId !== showPlayerMenu.playerId).map(p => (
                        <div key={p.userId} className="context-item" onClick={() => { handleCommanderDamage(p.userId, showPlayerMenu.playerId); setShowPlayerMenu(null); }}>
                            Cmdr Dmg from {p.username}
                        </div>
                    ))}
                    <div className="context-divider" />
                    <div className="context-item" onClick={() => { socket.emit('incrementCommanderDeaths', { targetPlayerId: showPlayerMenu.playerId }); setShowPlayerMenu(null); }}>
                        Commander Died
                    </div>
                    <div className="context-item" onClick={() => setShowPlayerMenu(null)}>Cancel</div>
                </div>
            )}

            {customCardModal && <CustomCardModal onClose={() => setCustomCardModal(false)} />}
            {bgModal && <BackgroundModal onClose={() => setBgModal(false)} />}
        </div>
    );
}

function CustomCardModal({ onClose }) {
    const [name, setName] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [typeLine, setTypeLine] = useState('');

    const handleCreate = () => {
        socket.emit('createCustomCard', { name, imageUrl, typeLine }, () => {});
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <h2>Create Custom Card</h2>
                <input type="text" placeholder="Card name" value={name} onChange={e => setName(e.target.value)} />
                <input type="text" placeholder="Image URL" value={imageUrl} onChange={e => setImageUrl(e.target.value)} />
                <input type="text" placeholder="Type line (optional)" value={typeLine} onChange={e => setTypeLine(e.target.value)} />
                <button onClick={handleCreate} className="primary-btn">Create on Battlefield</button>
            </div>
        </div>
    );
}

function BackgroundModal({ onClose }) {
    const [url, setUrl] = useState('');

    const handleSet = () => {
        socket.emit('setBackground', { imageUrl: url }, () => {});
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <h2>Set Background</h2>
                <input type="text" placeholder="Image URL" value={url} onChange={e => setUrl(e.target.value)} />
                <div className="modal-actions">
                    <button onClick={handleSet} className="primary-btn">Set</button>
                    <button onClick={() => { socket.emit('setBackground', { imageUrl: null }); onClose(); }}>Clear</button>
                </div>
            </div>
        </div>
    );
}
