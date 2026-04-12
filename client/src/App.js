import React, { useState, useEffect, useCallback } from 'react';
import socket from './socket';
import { auth } from './api';
import Login from './components/Login';
import Lobby from './components/Lobby';
import GameBoard from './components/GameBoard';
import { useDialog } from './components/Dialog';
import './App.css';

// Parse an /invite/{code} URL on first load. We don't pull in react-router just
// for this single route — we read window.location once, stash the code, and
// rewrite the URL to '/' so a refresh after leaving doesn't re-trigger a join.
function consumeInviteCode() {
    if (typeof window === 'undefined') return null;
    const m = window.location.pathname.match(/^\/invite\/([A-Za-z0-9]{4,12})\/?$/);
    if (!m) return null;
    const code = m[1].toUpperCase();
    try { window.history.replaceState({}, '', '/'); } catch (_) {}
    return code;
}

// Parse a /share/{code} URL — opens the import modal with the share code
// pre-filled so the recipient doesn't have to copy-paste it manually.
function consumeShareCode() {
    if (typeof window === 'undefined') return null;
    const m = window.location.pathname.match(/^\/share\/([A-Za-z0-9]{4,12})\/?$/);
    if (!m) return null;
    const code = m[1].toUpperCase();
    try { window.history.replaceState({}, '', '/'); } catch (_) {}
    return code;
}

export default function App() {
    const dialog = useDialog();
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [gameState, setGameState] = useState(null);
    const [roomCode, setRoomCode] = useState(null);
    // True when the current user joined as a spectator (read-only view, chat only).
    const [isSpectator, setIsSpectator] = useState(false);
    const [revealedCard, setRevealedCard] = useState(null);
    const [revealedHand, setRevealedHand] = useState(null); // { revealedBy, revealedByName, cards }
    const [reconnecting, setReconnecting] = useState(false);
    // Invite code pending auto-join (set once on mount; persisted through login).
    const [pendingInvite, setPendingInvite] = useState(() => consumeInviteCode());
    const [pendingShare, setPendingShare] = useState(() => consumeShareCode());

    useEffect(() => {
        auth.me().then(data => {
            if (data.user) setUser(data.user);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    // Save room code + spectator flag to localStorage when joining so reloads
    // can re-enter in the same mode.
    useEffect(() => {
        if (roomCode && user) {
            localStorage.setItem('mtg_lastRoom', roomCode);
            localStorage.setItem('mtg_lastRoomIsSpec', isSpectator ? '1' : '0');
        }
    }, [roomCode, user, isSpectator]);

    useEffect(() => {
        if (!user) return;
        console.log('[socket] connecting to', socket.io?.uri || 'server');
        socket.connect();

        const onConnect = () => {
            console.log('[socket] CONNECTED id=', socket.id);
            // Auto-rejoin only happens for the localStorage "saved room" case —
            // i.e. you were in a room, reloaded the page, and we want to drop
            // you back where you were, in the same role. Explicit invite links
            // (pendingInvite) go through the choose-role screen below instead
            // of auto-joining.
            if (pendingInvite) return;
            const target = localStorage.getItem('mtg_lastRoom');
            const rejoinAsSpec = localStorage.getItem('mtg_lastRoomIsSpec') === '1';
            if (target && !gameState) {
                setReconnecting(true);
                const eventName = rejoinAsSpec ? 'joinRoomAsSpectator' : 'joinRoom';
                socket.emit(eventName, { roomCode: target, userId: user.id, username: user.username }, (res) => {
                    setReconnecting(false);
                    if (res?.error) {
                        console.log('[socket] auto-join failed:', res.error);
                        localStorage.removeItem('mtg_lastRoom');
                        localStorage.removeItem('mtg_lastRoomIsSpec');
                    } else {
                        setRoomCode(target);
                        setIsSpectator(rejoinAsSpec);
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
        socket.on('handRevealed', ({ revealedBy, revealedByName, cards }) => {
            // Stash on gameState-adjacent state so GameBoard can render a hand viewer.
            setRevealedHand({ revealedBy, revealedByName, cards });
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
            socket.off('handRevealed');
            socket.off('cardPositionUpdate');
            socket.off('newStroke');
            socket.off('kicked');
            socket.disconnect();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    // Called from the invite-choice screen once the user picks a role. Emits
    // the appropriate join event against the pendingInvite code and clears
    // the pending state on success (or shows an error dialog on failure).
    const handleAcceptInvite = useCallback((asSpectator) => {
        if (!pendingInvite || !user) return;
        const target = pendingInvite;
        const eventName = asSpectator ? 'joinRoomAsSpectator' : 'joinRoom';
        setReconnecting(true);
        socket.emit(eventName, { roomCode: target, userId: user.id, username: user.username }, (res) => {
            setReconnecting(false);
            setPendingInvite(null);
            if (res?.error) {
                dialog.alert(`Couldn't join room ${target}: ${res.error}`, { title: 'Invite failed' });
                return;
            }
            setRoomCode(target);
            setIsSpectator(!!asSpectator);
        });
    }, [pendingInvite, user, dialog]);

    const handleDeclineInvite = useCallback(() => {
        setPendingInvite(null);
    }, []);

    const handleLeaveRoom = useCallback(() => {
        socket.emit('leaveRoom', () => {});
        localStorage.removeItem('mtg_lastRoom');
        localStorage.removeItem('mtg_lastRoomIsSpec');
        setGameState(null);
        setRoomCode(null);
        setIsSpectator(false);
    }, []);

    const handleLogout = useCallback(async () => {
        await auth.logout();
        socket.disconnect();
        localStorage.removeItem('mtg_lastRoom');
        localStorage.removeItem('mtg_lastRoomIsSpec');
        setUser(null);
        setGameState(null);
        setRoomCode(null);
        setIsSpectator(false);
    }, []);

    if (loading) return <div className="app-loading">Loading...</div>;
    if (!user) return <Login onLogin={setUser} />;
    if (reconnecting) return <div className="app-loading">Reconnecting to room...</div>;
    // Invite link landed them here — show a role-picker before touching state.
    // Sits above the lobby render so it takes precedence regardless of whether
    // the user had a saved room (which we skipped auto-rejoining because
    // pendingInvite is set).
    if (pendingInvite && !gameState) {
        return (
            <div className="lobby-page invite-choice-page">
                <div className="lobby-section invite-choice-card">
                    <h2>Join room {pendingInvite}</h2>
                    <p className="muted">
                        You've been invited to a game. Choose how you want to enter:
                    </p>
                    <div className="invite-choice-actions">
                        <button className="primary-btn" onClick={() => handleAcceptInvite(false)}>
                            Join as Player
                        </button>
                        <button onClick={() => handleAcceptInvite(true)}>
                            Join as Spectator
                        </button>
                    </div>
                    <p className="muted invite-choice-hint">
                        Players take a seat, draw cards, and play. Spectators watch
                        every hand face-up but can only chat — no interaction.
                    </p>
                    <button className="invite-choice-cancel" onClick={handleDeclineInvite}>
                        Cancel · go to lobby
                    </button>
                </div>
            </div>
        );
    }
    if (!gameState) return (
        <Lobby
            user={user}
            pendingShareCode={pendingShare}
            onShareConsumed={() => setPendingShare(null)}
            onJoinRoom={(code, opts = {}) => {
                setRoomCode(code);
                setIsSpectator(!!opts.asSpectator);
            }}
            onLogout={handleLogout}
        />
    );

    return (
        <GameBoard
            user={user}
            gameState={gameState}
            roomCode={roomCode}
            isSpectator={isSpectator || !!gameState.viewerIsSpectator}
            onLeave={handleLeaveRoom}
            revealedCard={revealedCard}
            onDismissReveal={() => setRevealedCard(null)}
            revealedHand={revealedHand}
            onDismissRevealedHand={() => setRevealedHand(null)}
        />
    );
}
