import { useEffect, useRef, useState } from 'react';

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

