import React, { useState, useEffect, useCallback } from 'react';
import socket from './socket';
import { auth } from './api';
import Login from './components/Login';
import Lobby from './components/Lobby';
import GameBoard from './components/GameBoard';
import './App.css';

export default function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [gameState, setGameState] = useState(null);
    const [roomCode, setRoomCode] = useState(null);
    const [revealedCard, setRevealedCard] = useState(null);

    useEffect(() => {
        auth.me().then(data => {
            if (data.user) setUser(data.user);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!user) return;
        socket.connect();

        socket.on('gameState', (state) => setGameState(state));
        socket.on('cardRevealed', ({ revealedBy, card }) => {
            setRevealedCard({ ...card, revealedBy });
        });
        socket.on('cardPositionUpdate', ({ instanceId, x, y, zIndex }) => {
            setGameState(prev => {
                if (!prev) return prev;
                const next = JSON.parse(JSON.stringify(prev));
                for (const player of next.players) {
                    const card = player.zones.battlefield.find(c => c.instanceId === instanceId);
                    if (card) {
                        card.x = x;
                        card.y = y;
                        if (zIndex !== undefined) card.zIndex = zIndex;
                        break;
                    }
                }
                return next;
            });
        });
        socket.on('newStroke', (stroke) => {
            setGameState(prev => {
                if (!prev) return prev;
                return { ...prev, drawings: [...(prev.drawings || []), stroke] };
            });
        });
        socket.on('phaseChanged', ({ phase }) => {
            setGameState(prev => prev ? { ...prev, currentPhase: phase } : prev);
        });

        return () => {
            socket.off('gameState');
            socket.off('cardRevealed');
            socket.off('cardPositionUpdate');
            socket.off('newStroke');
            socket.off('phaseChanged');
            socket.disconnect();
        };
    }, [user]);

    const handleLeaveRoom = useCallback(() => {
        socket.emit('leaveRoom', () => {});
        setGameState(null);
        setRoomCode(null);
    }, []);

    const handleLogout = useCallback(async () => {
        await auth.logout();
        socket.disconnect();
        setUser(null);
        setGameState(null);
        setRoomCode(null);
    }, []);

    if (loading) return <div className="app-loading">Loading...</div>;
    if (!user) return <Login onLogin={setUser} />;
    if (!gameState) return <Lobby user={user} onJoinRoom={(code) => setRoomCode(code)} onLogout={handleLogout} />;

    return (
        <GameBoard
            user={user}
            gameState={gameState}
            roomCode={roomCode}
            onLeave={handleLeaveRoom}
            revealedCard={revealedCard}
            onDismissReveal={() => setRevealedCard(null)}
        />
    );
}
