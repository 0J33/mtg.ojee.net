import React, { useEffect, useRef, useState, useCallback } from 'react';
import socket from '../socket';

/*
 * Live cursor overlay — shows other players' (and spectators') mouse cursors
 * on top of the game board. Only renders for non-compact desktop users on
 * both sides of the wire (touch devices and compact-mode users are filtered
 * out at the GameBoard level and never send/receive cursor events in the
 * first place).
 *
 * Coordinate handling mirrors DrawingCanvas: each cursor packet carries the
 * sender's container aspect ratio, and we letterbox into the largest rect
 * with that shape so cursors don't drift when viewers have slightly different
 * aspect ratios (e.g. 16:9 laptop vs 21:9 ultrawide).
 *
 * Cursors auto-fade after CURSOR_TIMEOUT ms of no updates.
 */

const CURSOR_TIMEOUT = 3000; // ms; entries older than this are culled
const CLEANUP_INTERVAL = 500;

// Deterministic hue from a user id so every viewer sees the same color for a
// given player. 0..359.
function hueFor(userId) {
    const s = String(userId || '');
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 360;
}

function computeRect(containerW, containerH, strokeAR) {
    if (!strokeAR || !isFinite(strokeAR) || strokeAR <= 0) {
        return { offsetX: 0, offsetY: 0, rectW: containerW, rectH: containerH };
    }
    const canvasAR = containerW / containerH;
    let rectW, rectH;
    if (canvasAR > strokeAR) {
        rectH = containerH;
        rectW = rectH * strokeAR;
    } else {
        rectW = containerW;
        rectH = rectW / strokeAR;
    }
    return { offsetX: (containerW - rectW) / 2, offsetY: (containerH - rectH) / 2, rectW, rectH };
}

export default function Cursors({ containerRef, currentUserId, players }) {
    // Map of userId -> { x, y, aspectRatio, username, isSpectator, ts }
    const [cursors, setCursors] = useState(() => new Map());
    // Re-render on a slow timer so stale cursors fade out even when nobody is
    // sending. Tracked via a counter state that bumps each tick.
    const [, forceTick] = useState(0);
    const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

    // Track the container element size so we can project cursors into pixel
    // space. ResizeObserver fires on layout changes (window resize, sidebar
    // open/close, etc.) without us having to manually hook resize events.
    useEffect(() => {
        const el = containerRef?.current;
        if (!el) return;
        const update = () => {
            const rect = el.getBoundingClientRect();
            setContainerSize({ w: rect.width, h: rect.height });
        };
        update();
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(update);
            ro.observe(el);
            return () => ro.disconnect();
        }
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, [containerRef]);

    // Listen for cursor events. We store a Map by userId and replace on each
    // incoming packet. Use a functional setState so concurrent updates don't
    // clobber each other.
    useEffect(() => {
        const onCursor = (evt) => {
            if (!evt || !evt.userId) return;
            if (evt.userId === currentUserId) return; // never show our own cursor
            setCursors(prev => {
                const next = new Map(prev);
                next.set(evt.userId, {
                    x: evt.x,
                    y: evt.y,
                    aspectRatio: evt.aspectRatio,
                    username: evt.username || 'Player',
                    isSpectator: !!evt.isSpectator,
                    // Optional override color when the sender is actively
                    // drawing — makes the cursor match their brush. Falls
                    // back to the hash-based hue below when absent.
                    color: evt.color || null,
                    ts: evt.ts || Date.now(),
                });
                return next;
            });
        };
        socket.on('cursorMove', onCursor);
        return () => socket.off('cursorMove', onCursor);
    }, [currentUserId]);

    // Periodic sweep to drop stale cursors. Runs independently of incoming
    // events so an idle cursor eventually disappears.
    useEffect(() => {
        const timer = setInterval(() => {
            const now = Date.now();
            let changed = false;
            setCursors(prev => {
                const next = new Map(prev);
                for (const [id, c] of next) {
                    if (now - c.ts > CURSOR_TIMEOUT) {
                        next.delete(id);
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
            forceTick(n => (n + 1) & 0xffff); // nudge for opacity re-eval below
        }, CLEANUP_INTERVAL);
        return () => clearInterval(timer);
    }, []);

    const { w: cw, h: ch } = containerSize;
    const entries = [];
    if (cw > 0 && ch > 0) {
        for (const [userId, c] of cursors) {
            const { offsetX, offsetY, rectW, rectH } = computeRect(cw, ch, c.aspectRatio);
            const px = offsetX + c.x * rectW;
            const py = offsetY + c.y * rectH;
            // Clamp so a bad packet can't render off-screen; the server also
            // clamps to 0..1 but double-guard is cheap.
            if (!isFinite(px) || !isFinite(py)) continue;
            const age = Date.now() - c.ts;
            const opacity = age < CURSOR_TIMEOUT - 500
                ? 1
                : Math.max(0, (CURSOR_TIMEOUT - age) / 500);
            entries.push({
                userId,
                x: Math.max(0, Math.min(cw - 20, px)),
                y: Math.max(0, Math.min(ch - 20, py)),
                username: c.username,
                isSpectator: c.isSpectator,
                // Prefer the sender's provided color (pen-active); fall back
                // to the player's avatar color; last resort is hash-derived.
                color: c.color
                    || (players || []).find(p => p.userId === userId)?.avatarColor
                    || `hsl(${hueFor(userId)} 70% 55%)`,
                opacity,
            });
        }
    }

    return (
        <div className="cursors-overlay" aria-hidden="true">
            {entries.map(e => (
                <div
                    key={e.userId}
                    className={`cursor-marker ${e.isSpectator ? 'spec' : ''}`}
                    style={{
                        transform: `translate(${e.x}px, ${e.y}px)`,
                        opacity: e.opacity,
                        '--cursor-color': e.color,
                    }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" style={{ display: 'block', overflow: 'visible' }}>
                        {/* Classic pointer shape. Uses currentColor so the label + arrow share the hue. */}
                        <path
                            d="M4 2 L4 20 L9 15 L12 22 L15 20 L12 13 L19 13 Z"
                            fill="var(--cursor-color)"
                            stroke="#000"
                            strokeWidth="1"
                            strokeLinejoin="round"
                        />
                    </svg>
                    <span className="cursor-label">{e.username}{e.isSpectator && ' [spec]'}</span>
                </div>
            ))}
        </div>
    );
}
