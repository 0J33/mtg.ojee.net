import React, { useEffect, useRef, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function ContextMenu({ x, y, items, onClose }) {
    const ref = useRef();
    const [pos, setPos] = useState(null);

    // Synchronously measure and clamp before paint
    useLayoutEffect(() => {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const w = rect.width || 200;
        const h = rect.height || items.length * 30;
        const left = Math.max(4, Math.min(x, window.innerWidth - w - 4));
        const top = Math.max(4, Math.min(y, window.innerHeight - h - 4));
        setPos({ left, top });
    }, [x, y, items]);

    useEffect(() => {
        // Don't bind until next tick so the right-click that opened us isn't caught
        let bound = false;
        const handler = (e) => {
            if (!ref.current) return;
            if (!ref.current.contains(e.target)) onClose();
        };
        const id = window.setTimeout(() => {
            window.addEventListener('mousedown', handler, true);
            bound = true;
        }, 50);
        return () => {
            window.clearTimeout(id);
            if (bound) window.removeEventListener('mousedown', handler, true);
        };
    }, [onClose]);

    const style = pos
        ? { left: pos.left, top: pos.top }
        : { left: x, top: y, visibility: 'hidden' };

    return createPortal(
        <div className="context-menu" ref={ref} style={style}>
            {items.map((item, i) => {
                if (item.divider) return <div key={i} className="context-divider" />;
                return (
                    <div
                        key={i}
                        className={`context-item ${item.danger ? 'danger' : ''}`}
                        onClick={(e) => { e.stopPropagation(); item.onClick(); onClose(); }}
                    >
                        {item.label}
                    </div>
                );
            })}
        </div>,
        document.body
    );
}
