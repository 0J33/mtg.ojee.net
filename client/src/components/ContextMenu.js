import React, { useEffect, useRef } from 'react';

export default function ContextMenu({ x, y, items, onClose }) {
    const ref = useRef();

    useEffect(() => {
        const handleClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) onClose();
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

    // Adjust position to keep menu in viewport
    const style = {
        left: Math.min(x, window.innerWidth - 200),
        top: Math.min(y, window.innerHeight - items.length * 36 - 20),
    };

    return (
        <div className="context-menu" ref={ref} style={style}>
            {items.map((item, i) => {
                if (item.divider) return <div key={i} className="context-divider" />;
                return (
                    <div
                        key={i}
                        className={`context-item ${item.danger ? 'danger' : ''}`}
                        onClick={() => { item.onClick(); onClose(); }}
                    >
                        {item.label}
                    </div>
                );
            })}
        </div>
    );
}
