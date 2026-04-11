import React, { useState, useEffect, useRef, useCallback } from 'react';
import socket from '../socket';

/*
 * Chat sidebar — slides in from the right edge of the screen, hideable via a
 * toggle button on the right edge. Used by both players and spectators; the
 * latter are the only ones who can only chat (no game actions).
 *
 * Props:
 *   messages     — full chat history from gameState (authoritative on mount / reconnect)
 *   currentUserId — used to style own messages
 *   onNewMessage — called when a chat message arrives while the panel is hidden,
 *                  so the parent can show an unread-badge on the toggle button
 */
export default function Chat({ messages: historyMessages, currentUserId, open, onToggle }) {
    // Local mirror of messages so we can append newly received ones without
    // waiting for the next full gameState broadcast.
    const [messages, setMessages] = useState(historyMessages || []);
    const [draft, setDraft] = useState('');
    const [unread, setUnread] = useState(0);
    const listRef = useRef(null);
    const inputRef = useRef(null);

    // Whenever the authoritative history changes (e.g. on reconnect or initial
    // load), replace the local mirror. Incoming `chatMessage` events during a
    // session are handled separately below and dedupe against this.
    useEffect(() => {
        setMessages(historyMessages || []);
    }, [historyMessages]);

    // Listen for incoming chat messages. We append by id, skipping duplicates
    // (in case the message also shows up in a later gameState broadcast).
    useEffect(() => {
        const onChat = (msg) => {
            setMessages(prev => {
                if (prev.some(m => m.id === msg.id)) return prev;
                return [...prev, msg];
            });
            if (!open && msg.userId !== currentUserId) {
                setUnread(u => u + 1);
            }
        };
        socket.on('chatMessage', onChat);
        return () => socket.off('chatMessage', onChat);
    }, [open, currentUserId]);

    // Auto-scroll to bottom on new message when panel is open. Using rAF so the
    // DOM has laid out the new row before we measure scrollHeight.
    useEffect(() => {
        if (!open) return;
        const el = listRef.current;
        if (!el) return;
        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }, [messages, open]);

    // Clear unread counter whenever the panel becomes visible.
    useEffect(() => {
        if (open) setUnread(0);
    }, [open]);

    const send = useCallback(() => {
        const text = draft.trim();
        if (!text) return;
        socket.emit('sendChatMessage', { text }, (res) => {
            if (res?.error) console.warn('[chat] send failed:', res.error);
        });
        setDraft('');
    }, [draft]);

    const handleKeyDown = (e) => {
        // Enter sends, Shift+Enter inserts a newline.
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    };

    // Format timestamp as HH:MM local time.
    const fmtTime = (ts) => {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <>
            {/* Toggle button — stays on the right edge, in-page, so it doesn't
                collide with the drawing toggle at the bottom-right. */}
            <button
                className={`chat-toggle ${open ? 'open' : ''}`}
                onClick={onToggle}
                title={open ? 'Hide chat' : 'Show chat'}
                type="button"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {unread > 0 && !open && <span className="chat-unread-badge">{unread > 9 ? '9+' : unread}</span>}
            </button>

            <aside className={`chat-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
                <div className="chat-header">
                    <h3>Chat</h3>
                    <button className="close-btn" onClick={onToggle} type="button">x</button>
                </div>
                <div className="chat-messages" ref={listRef}>
                    {messages.length === 0 && <div className="chat-empty">No messages yet.</div>}
                    {messages.map(m => (
                        <div
                            key={m.id}
                            className={`chat-msg ${m.userId === currentUserId ? 'mine' : ''} ${m.isSpectator ? 'spectator' : ''}`}
                        >
                            <div className="chat-msg-meta">
                                <span className="chat-msg-user">{m.username}{m.isSpectator && ' [spec]'}</span>
                                <span className="chat-msg-time">{fmtTime(m.ts)}</span>
                            </div>
                            <div className="chat-msg-text">{m.text}</div>
                        </div>
                    ))}
                </div>
                <div className="chat-input-row">
                    <textarea
                        ref={inputRef}
                        className="chat-input"
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Message..."
                        rows={2}
                        maxLength={500}
                    />
                    <button className="chat-send-btn primary-btn" onClick={send} type="button">Send</button>
                </div>
            </aside>
        </>
    );
}
