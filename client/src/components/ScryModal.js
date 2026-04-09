import React, { useState } from 'react';
import socket from '../socket';
import Card from './Card';

export default function ScryModal({ cards, onClose }) {
    const [order, setOrder] = useState(cards.map(c => c.instanceId));
    const [toBottom, setToBottom] = useState(new Set());

    const toggleBottom = (id) => {
        setToBottom(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const moveUp = (idx) => {
        if (idx === 0) return;
        setOrder(prev => {
            const next = [...prev];
            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
            return next;
        });
    };

    const moveDown = (idx) => {
        if (idx >= order.length - 1) return;
        setOrder(prev => {
            const next = [...prev];
            [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
            return next;
        });
    };

    const handleConfirm = () => {
        const bottomIds = Array.from(toBottom);
        const topIds = order.filter(id => !toBottom.has(id));

        if (topIds.length > 0) {
            socket.emit('reorderTopCards', { cardOrder: topIds });
        }
        if (bottomIds.length > 0) {
            socket.emit('scryToBottom', { instanceIds: bottomIds });
        }
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal scry-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Scry {cards.length}</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <p className="muted">Click cards to send to bottom. Drag to reorder top.</p>
                <div className="scry-cards">
                    {order.map((id, idx) => {
                        const card = cards.find(c => c.instanceId === id);
                        if (!card) return null;
                        const isBottom = toBottom.has(id);
                        return (
                            <div key={id} className={`scry-card ${isBottom ? 'to-bottom' : ''}`}>
                                <Card card={card} onClick={() => toggleBottom(id)} small />
                                <div className="scry-card-label">
                                    {isBottom ? 'BOTTOM' : `Top #${idx + 1}`}
                                </div>
                                {!isBottom && (
                                    <div className="scry-card-controls">
                                        <button onClick={() => moveUp(idx)} disabled={idx === 0}>up</button>
                                        <button onClick={() => moveDown(idx)} disabled={idx === order.length - 1}>dn</button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                <button onClick={handleConfirm} className="primary-btn">Confirm</button>
            </div>
        </div>
    );
}
