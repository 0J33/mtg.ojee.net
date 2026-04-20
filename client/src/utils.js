import React, { useEffect, useRef, useState } from 'react';

// Must match server's gameState.INFINITE sentinel. Values at or above this
// threshold render as "∞" in the UI so combo players can express infinite
// resources (life, poison counters, commander damage, etc.) without tripping
// JSON serialization (JSON can't encode JS Infinity).
export const INFINITE = 9999;

export function isInfinite(v) {
    return typeof v === 'number' && v >= INFINITE;
}

// Format a numeric value for display — returns "∞" for values at/above the
// infinite threshold, or the number as-is. Accepts null/undefined and returns
// a dash for those.
export function fmtNum(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'number' && v >= INFINITE) return '∞';
    if (typeof v === 'number' && v <= -INFINITE) return '-∞';
    return String(v);
}

// Parse user input for a game-value field. Accepts numbers, or strings like
// "∞" / "inf" / "infinity". Returns a number (INFINITE for infinite input),
// or NaN if the input can't be parsed.
export function parseGameValue(input) {
    if (input === null || input === undefined) return NaN;
    if (typeof input === 'number') return input;
    const s = String(input).trim().toLowerCase();
    if (s === '') return NaN;
    if (s === '∞' || s === 'inf' || s === 'infinity' || s === 'infinite') return INFINITE;
    const n = parseInt(s, 10);
    return isNaN(n) ? NaN : n;
}

export function v4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
    });
}

// Close modal/popup when Escape is pressed
export function useEscapeKey(onEscape) {
    useEffect(() => {
        const handler = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onEscape();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onEscape]);
}

// Detect a touch-only device (phones, tablets without mice). Re-evaluates if the
// matchMedia changes (e.g. external mouse plugged in). Some Firefox builds on
// touchscreen laptops report (hover: none) incorrectly — so we also flip to
// non-touch if we ever see a real mousemove event (which touch-only devices
// never produce).
export function useIsTouchDevice() {
    const [isTouch, setIsTouch] = useState(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return false;
        return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    });
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mq = window.matchMedia('(hover: none) and (pointer: coarse)');
        const handler = (e) => setIsTouch(e.matches);
        if (mq.addEventListener) mq.addEventListener('change', handler);
        else mq.addListener(handler);
        // Fallback: if a real mouse pointer event fires, this is NOT a touch-only
        // device. Firefox on some touchscreen laptops misreports the media query.
        // ONLY use pointermove (which has pointerType) — NOT mousemove, because
        // taps on mobile generate synthetic mousemove events that would
        // incorrectly flip isTouch to false.
        const onPointer = (e) => {
            if (e.pointerType !== 'mouse') return;
            setIsTouch(false);
            window.removeEventListener('pointermove', onPointer);
        };
        window.addEventListener('pointermove', onPointer);
        return () => {
            if (mq.removeEventListener) mq.removeEventListener('change', handler);
            else mq.removeListener(handler);
            window.removeEventListener('pointermove', onPointer);
        };
    }, []);
    return isTouch;
}

// useVerticalDragPos — lets a fixed-positioned side toggle be dragged
// vertically by the user. Returns { topStyle, dragHandlers, reset } —
// spread dragHandlers onto the element, apply topStyle to override its
// centered CSS position when the user has moved it. Position persists
// per key in localStorage so the button stays where the user left it
// across sessions. Tap (no meaningful movement) still fires the
// element's onClick handler because we use pointer events and only
// swallow the click when drag actually happened.
export function useVerticalDragPos(key, defaultTop = '50%') {
    const [top, setTop] = useState(() => {
        try {
            const raw = localStorage.getItem(key);
            if (raw !== null) {
                const v = parseInt(raw, 10);
                if (!isNaN(v)) return v;
            }
        } catch (_) {}
        return null; // null = use CSS default
    });
    const dragRef = useRef(null); // { pointerId, startY, origTop, moved }
    // Set true on pointerup when drag moved, so the synthetic click that
    // fires after the pointer gesture can be swallowed. Cleared on click.
    const justDraggedRef = useRef(false);

    useEffect(() => {
        // Clamp on window resize so the toggle can't end up off-screen.
        if (top === null) return;
        const onResize = () => setTop(t => (typeof t === 'number' ? Math.max(20, Math.min(t, window.innerHeight - 60)) : t));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [top]);

    const onPointerDown = (e) => {
        // Only left button / primary pointer
        if (e.button !== undefined && e.button !== 0) return;
        const el = e.currentTarget;
        const rect = el.getBoundingClientRect();
        dragRef.current = {
            pointerId: e.pointerId,
            startY: e.clientY,
            origTop: rect.top + rect.height / 2, // center of the toggle
            moved: false,
        };
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
    };
    const onPointerMove = (e) => {
        const d = dragRef.current;
        if (!d || d.pointerId !== e.pointerId) return;
        const dy = e.clientY - d.startY;
        if (!d.moved) {
            if (Math.abs(dy) < 4) return;
            d.moved = true;
        }
        const next = Math.max(20, Math.min(d.origTop + dy, window.innerHeight - 30));
        setTop(next);
    };
    const onPointerUp = (e) => {
        const d = dragRef.current;
        if (!d || d.pointerId !== e.pointerId) return;
        dragRef.current = null;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
        if (d.moved) {
            justDraggedRef.current = true;
            if (typeof top === 'number') {
                try { localStorage.setItem(key, String(top)); } catch (_) {}
            }
        }
    };
    // Suppress the synthetic click that fires after a real drag so the
    // toggle's own onClick (which opens / closes the panel) doesn't fire
    // at the end of a drag.
    const onClickCapture = (e) => {
        if (justDraggedRef.current) {
            justDraggedRef.current = false;
            e.stopPropagation();
            e.preventDefault();
        }
    };

    const reset = () => {
        setTop(null);
        try { localStorage.removeItem(key); } catch (_) {}
    };

    return {
        topStyle: top !== null ? { top: `${top}px`, transform: 'translateY(-50%)' } : undefined,
        dragHandlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
            onClickCapture,
        },
        reset,
        moved: top !== null,
    };
}

// Drop-in wrapper for a modal overlay — handles outside-click-to-close
// while ignoring drags that started inside. Keeps the existing
// .modal-overlay styling (z-index, flex centering, etc.) so there's no
// visual change. Usage:
//   <ModalOverlay onClose={onClose} className="card-max-overlay">
//     <div className="modal">...</div>
//   </ModalOverlay>
export function ModalOverlay({ onClose, className = '', style, children }) {
    const overlayProps = useOutsideClose(onClose);
    return (
        <div className={`modal-overlay ${className}`} style={style} {...overlayProps}>
            {children}
        </div>
    );
}

// Build props for a modal overlay that closes on an outside click BUT
// refuses to close when the user was dragging (e.g. selecting text in an
// input, dragging a file, or sliding a range input inside the modal and
// releasing the mouse outside). We detect by stamping a ref on mousedown
// inside the modal content and only treating the click as "outside" when
// both mousedown AND mouseup land on the overlay itself.
//
// Usage:
//   const overlayProps = useOutsideClose(onClose);
//   <div className="modal-overlay" {...overlayProps}>
//     <div className="modal" onClick={e => e.stopPropagation()}>...</div>
//   </div>
export function useOutsideClose(onClose) {
    const downInsideRef = useRef(false);
    return {
        onMouseDown: (e) => {
            // If mousedown originated on the modal itself (not the overlay),
            // remember that so a subsequent mouseup outside doesn't count as
            // an "outside click".
            downInsideRef.current = e.target !== e.currentTarget;
        },
        onClick: (e) => {
            // Only close if both mousedown and mouseup were on the overlay.
            if (e.target === e.currentTarget && !downInsideRef.current) {
                onClose?.();
            }
            downInsideRef.current = false;
        },
    };
}

// Convert vertical mouse wheel scrolling into horizontal scrolling on a ref'd element.
// Only when the element actually overflows horizontally, otherwise the wheel is ignored
// and the page can still scroll normally above it.
export function useHorizontalWheel() {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const handler = (e) => {
            // Only intercept "pure" vertical wheel events; trackpads delivering horizontal deltas
            // already work natively.
            if (e.deltaY === 0) return;
            if (el.scrollWidth <= el.clientWidth) return;
            e.preventDefault();
            el.scrollLeft += e.deltaY;
        };
        el.addEventListener('wheel', handler, { passive: false });
        return () => el.removeEventListener('wheel', handler);
    }, []);
    return ref;
}

