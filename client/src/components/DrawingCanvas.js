import React, { useRef, useState, useEffect, useCallback } from 'react';
import socket from '../socket';
import { v4 as uuidv4 } from '../utils';

export default function DrawingCanvas({ drawings, enabled, onToggle }) {
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentStroke, setCurrentStroke] = useState([]);
    const [color, setColor] = useState('#ff0000');
    const [brushSize, setBrushSize] = useState(3);

    const colors = ['#ff0000', '#00ff00', '#0088ff', '#ffff00', '#ff00ff', '#ffffff', '#000000', '#ff8800'];

    // Redraw all strokes
    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = canvas.parentElement.offsetWidth;
        canvas.height = canvas.parentElement.offsetHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const allStrokes = [...(drawings || [])];
        if (currentStroke.length > 0) {
            allStrokes.push({ points: currentStroke, color, size: brushSize });
        }

        for (const stroke of allStrokes) {
            if (!stroke.points || stroke.points.length < 2) continue;
            ctx.beginPath();
            ctx.strokeStyle = stroke.color || '#ff0000';
            ctx.lineWidth = stroke.size || 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
            }
            ctx.stroke();
        }
    }, [drawings, currentStroke, color, brushSize]);

    useEffect(() => { redraw(); }, [redraw]);

    useEffect(() => {
        const handleResize = () => redraw();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [redraw]);

    const getPos = (e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleMouseDown = (e) => {
        if (!enabled || e.button !== 0) return;
        setIsDrawing(true);
        setCurrentStroke([getPos(e)]);
    };

    const handleMouseMove = (e) => {
        if (!isDrawing) return;
        setCurrentStroke(prev => [...prev, getPos(e)]);
    };

    const handleMouseUp = () => {
        if (!isDrawing) return;
        setIsDrawing(false);
        if (currentStroke.length > 1) {
            const strokeId = Date.now().toString(36) + Math.random().toString(36).slice(2);
            socket.emit('drawStroke', { strokeId, points: currentStroke, color, size: brushSize });
        }
        setCurrentStroke([]);
    };

    const clearDrawings = (mine) => {
        socket.emit('clearDrawings', { mine }, () => {});
    };

    return (
        <div className={`drawing-layer ${enabled ? 'active' : ''}`}>
            <canvas
                ref={canvasRef}
                className="drawing-canvas"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{ pointerEvents: enabled ? 'auto' : 'none' }}
            />
            {enabled && (
                <div className="drawing-toolbar">
                    <div className="color-picker">
                        {colors.map(c => (
                            <button
                                key={c}
                                className={`color-swatch ${color === c ? 'active' : ''}`}
                                style={{ background: c }}
                                onClick={() => setColor(c)}
                            />
                        ))}
                    </div>
                    <div className="brush-size">
                        <input type="range" min={1} max={12} value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))} />
                    </div>
                    <button onClick={() => clearDrawings(true)} className="small-btn">Clear Mine</button>
                    <button onClick={() => clearDrawings(false)} className="small-btn">Clear All</button>
                </div>
            )}
            <button className={`drawing-toggle ${enabled ? 'active' : ''}`} onClick={onToggle} title="Toggle drawing">
                Draw
            </button>
        </div>
    );
}
