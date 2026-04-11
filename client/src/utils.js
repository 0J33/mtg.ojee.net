import { useEffect, useRef, useState } from 'react';

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
// matchMedia changes (e.g. external mouse plugged in).
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
        return () => {
            if (mq.removeEventListener) mq.removeEventListener('change', handler);
            else mq.removeListener(handler);
        };
    }, []);
    return isTouch;
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

