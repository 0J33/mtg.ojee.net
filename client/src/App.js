import React, { useState, useEffect, useCallback } from 'react';
import socket from './socket';
import { auth } from './api';
import Login from './components/Login';
import Lobby from './components/Lobby';
import GameBoard from './components/GameBoard';
import { useDialog } from './components/Dialog';
import './App.css';

export default function App() {
    const dialog = useDialog();
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [gameState, setGameState] = useState(null);
    const [roomCode, setRoomCode] = useState(null);
    const [revealedCard, setRevealedCard] = useState(null);
    const [reconnecting, setReconnecting] = useState(false);

    useEffect(() => {
        auth.me().then(data => {
            if (data.user) setUser(data.user);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    // Save room code to localStorage when joining
    useEffect(() => {
        if (roomCode && user) {
            localStorage.setItem('mtg_lastRoom', roomCode);
        }
    }, [roomCode, user]);

    useEffect(() => {
        if (!user) return;
        console.log('[socket] connecting to', socket.io?.uri || 'server');
        socket.connect();

        const onConnect = () => {
            console.log('[socket] CONNECTED id=', socket.id);
            // Auto-rejoin if we have a saved room
            const savedRoom = localStorage.getItem('mtg_lastRoom');
            if (savedRoom && !gameState) {
                setReconnecting(true);
                socket.emit('joinRoom', { roomCode: savedRoom, userId: user.id, username: user.username }, (res) => {
                    setReconnecting(false);
                    if (res?.error) {
                        console.log('[socket] auto-rejoin failed:', res.error);
                        localStorage.removeItem('mtg_lastRoom');
                    } else {
                        setRoomCode(savedRoom);
                    }
                });
            }
        };

        socket.on('connect', onConnect);
        socket.on('disconnect', (reason) => console.log('[socket] DISCONNECTED reason=', reason));
        socket.on('connect_error', (err) => console.error('[socket] CONNECT ERROR:', err.message, err));
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
        socket.on('kicked', () => {
            dialog.alert('You were kicked from the room.', { title: 'Kicked' });
            localStorage.removeItem('mtg_lastRoom');
            setGameState(null);
            setRoomCode(null);
        });
        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect');
            socket.off('connect_error');
            socket.off('gameState');
            socket.off('cardRevealed');
            socket.off('cardPositionUpdate');
            socket.off('newStroke');
            socket.off('kicked');
            socket.disconnect();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    const handleLeaveRoom = useCallback(() => {
        socket.emit('leaveRoom', () => {});
        localStorage.removeItem('mtg_lastRoom');
        setGameState(null);
        setRoomCode(null);
    }, []);

    const handleLogout = useCallback(async () => {
        await auth.logout();
        socket.disconnect();
        localStorage.removeItem('mtg_lastRoom');
        setUser(null);
        setGameState(null);
        setRoomCode(null);
    }, []);

    if (loading) return <div className="app-loading">Loading...</div>;
    if (!user) return <Login onLogin={setUser} />;
    if (reconnecting) return <div className="app-loading">Reconnecting to room...</div>;
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
