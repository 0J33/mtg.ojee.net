import React, { useRef, useState, useEffect, useCallback } from 'react';
import socket from '../socket';
import { useEscapeKey } from '../utils';

export default function DrawingCanvas({ drawings, enabled, onToggle }) {
    useEscapeKey(() => { if (enabled) onToggle(); });
    const canvasRef = useRef(null);
    const isDrawingRef = useRef(false);
    const currentStrokeRef = useRef([]);
    const localStrokesRef = useRef([]); // Strokes we drew locally (not yet in server state)
    const [color, setColor] = useState('#ff0000');
    const [brushSize, setBrushSize] = useState(3);
    const [, forceRerender] = useState(0);

    const colors = [
        '#ff0000', '#ff4488', '#ff8800', '#ffcc00', '#ffff00',
        '#88ff00', '#00ff00', '#00ffaa', '#00ffff', '#0088ff',
        '#0044ff', '#8800ff', '#ff00ff', '#ffffff', '#888888', '#000000',
    ];

    // Merge server drawings + local strokes (deduped by strokeId)
    const getAllStrokes = useCallback(() => {
        const serverIds = new Set((drawings || []).map(d => d.strokeId));
        const localOnly = localStrokesRef.current.filter(s => !serverIds.has(s.strokeId));
        return [...(drawings || []), ...localOnly];
    }, [drawings]);

    // Once server confirms our local stroke, drop it from local cache
    useEffect(() => {
        if (!drawings || drawings.length === 0) return;
        const serverIds = new Set(drawings.map(d => d.strokeId));
        localStrokesRef.current = localStrokesRef.current.filter(s => !serverIds.has(s.strokeId));
    }, [drawings]);

    // Stroke points are stored as normalized 0-1 coordinates so they're consistent across screen sizes.
    const drawStroke = (ctx, stroke) => {
        if (!stroke.points || stroke.points.length < 1) return;
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        ctx.beginPath();
        ctx.strokeStyle = stroke.color || '#ff0000';
        ctx.lineWidth = stroke.size || 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const px = (p) => ({ x: p.x * w, y: p.y * h });
        if (stroke.points.length === 1) {
            const p = px(stroke.points[0]);
            ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
            ctx.fillStyle = stroke.color || '#ff0000';
            ctx.fill();
            return;
        }
        const first = px(stroke.points[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < stroke.points.length; i++) {
            const p = px(stroke.points[i]);
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
    };

    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const parent = canvas.parentElement;
        if (canvas.width !== parent.offsetWidth) canvas.width = parent.offsetWidth;
        if (canvas.height !== parent.offsetHeight) canvas.height = parent.offsetHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const stroke of getAllStrokes()) {
            drawStroke(ctx, stroke);
        }

        // In-progress stroke
        if (currentStrokeRef.current.length > 0) {
            drawStroke(ctx, { points: currentStrokeRef.current, color, size: brushSize });
        }
    }, [getAllStrokes, color, brushSize]);

    useEffect(() => { redraw(); });

    useEffect(() => {
        const handleResize = () => redraw();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [redraw]);

    // Listen for incoming strokes from other players via socket
    useEffect(() => {
        const onNewStroke = (stroke) => {
            // The newStroke event comes from another player. Add it to local cache so it appears
            // immediately, then it'll be in the next gameState broadcast too.
            localStrokesRef.current.push(stroke);
            forceRerender(n => n + 1);
        };
        socket.on('newStroke', onNewStroke);
        return () => socket.off('newStroke', onNewStroke);
    }, []);

    // Returns normalized 0-1 coordinates relative to canvas size
    const getPos = (e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height,
        };
    };

    const handleMouseDown = (e) => {
        if (!enabled || e.button !== 0) return;
        isDrawingRef.current = true;
        currentStrokeRef.current = [getPos(e)];
        forceRerender(n => n + 1);
    };

    const handleMouseMove = (e) => {
        if (!isDrawingRef.current) return;
        currentStrokeRef.current.push(getPos(e));
        // Draw incremental segment instead of full redraw to reduce flicker
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const pts = currentStrokeRef.current;
        if (pts.length < 2) return;
        const w = canvas.width;
        const h = canvas.height;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(pts[pts.length - 2].x * w, pts[pts.length - 2].y * h);
        ctx.lineTo(pts[pts.length - 1].x * w, pts[pts.length - 1].y * h);
        ctx.stroke();
    };

    const handleMouseUp = () => {
        if (!isDrawingRef.current) return;
        isDrawingRef.current = false;
        const points = currentStrokeRef.current;
        if (points.length > 0) {
            const strokeId = Date.now().toString(36) + Math.random().toString(36).slice(2);
            const stroke = { strokeId, points: [...points], color, size: brushSize };
            // Add to local cache immediately so it stays visible
            localStrokesRef.current.push(stroke);
            socket.emit('drawStroke', stroke);
        }
        currentStrokeRef.current = [];
        forceRerender(n => n + 1);
    };

    const clearDrawings = (mine) => {
        if (mine) {
            localStrokesRef.current = [];
        } else {
            localStrokesRef.current = [];
        }
        socket.emit('clearDrawings', { mine }, () => {});
        forceRerender(n => n + 1);
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19l7-7 3 3-7 7-3-3z" />
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                    <path d="M2 2l7.586 7.586" />
                    <circle cx="11" cy="11" r="2" />
                </svg>
            </button>
        </div>
    );
}
