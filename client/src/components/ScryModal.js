import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import socket from '../socket';
import Card from './Card';
import { useEscapeKey } from '../utils';

export default function ScryModal({ cards, onClose }) {
    useEscapeKey(onClose);
    const [order, setOrder] = useState(cards.map(c => c.instanceId));
    const [toBottom, setToBottom] = useState(new Set());
    const [draggingId, setDraggingId] = useState(null);

    const toggleBottom = (id) => {
        setToBottom(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleDragStart = (e, id) => {
        setDraggingId(id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e, targetId) => {
        e.preventDefault();
        if (!draggingId || draggingId === targetId) return;
        setOrder(prev => {
            const next = prev.filter(id => id !== draggingId);
            const targetIdx = next.indexOf(targetId);
            if (targetIdx === -1) return prev;
            next.splice(targetIdx, 0, draggingId);
            return next;
        });
        setDraggingId(null);
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

    return createPortal(
        <div className="modal-overlay">
            <div className="modal scry-modal">
                <div className="modal-header">
                    <h2>Scry {cards.length}</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>
                <p className="muted">Click cards to mark for bottom. Drag to reorder top of library.</p>
                <div className="scry-cards">
                    {order.map((id, idx) => {
                        const card = cards.find(c => c.instanceId === id);
                        if (!card) return null;
                        const isBottom = toBottom.has(id);
                        return (
                            <div
                                key={id}
                                className={`scry-card ${isBottom ? 'to-bottom' : ''} ${draggingId === id ? 'dragging' : ''}`}
                                draggable
                                onDragStart={(e) => handleDragStart(e, id)}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, id)}
                                onDragEnd={() => setDraggingId(null)}
                            >
                                <Card card={card} onClick={() => toggleBottom(id)} />
                                <div className="scry-card-label">
                                    {isBottom ? 'BOTTOM' : `Top #${idx + 1}`}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <button onClick={handleConfirm} className="primary-btn">Confirm</button>
            </div>
        </div>,
        document.body
    );
}
