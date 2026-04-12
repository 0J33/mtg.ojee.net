import React, { useRef, useState, useEffect, useCallback } from 'react';
import socket from '../socket';
import { useEscapeKey } from '../utils';

export default function DrawingCanvas({ drawings, enabled, onToggle, hideToggle, penStateRef, onPenColorChange }) {
    useEscapeKey(() => { if (enabled) onToggle(); });
    const canvasRef = useRef(null);
    const isDrawingRef = useRef(false);
    const currentStrokeRef = useRef([]);
    const localStrokesRef = useRef([]); // Strokes we drew locally (not yet in server state)
    // IDs of strokes erased locally (not yet confirmed by server). Used to
    // filter them out of getAllStrokes so the user sees the erase immediately.
    const localErasedRef = useRef(new Set());
    // Color + brush persist across sessions so you don't have to re-pick your
    // preferred red every time you open the pen. Cursor color tracks this
    // automatically because GameBoard reads the pen state out of a ref.
    const [color, setColor] = useState(() => {
        try { return localStorage.getItem('mtg_penColor') || '#ff0000'; }
        catch (_) { return '#ff0000'; }
    });
    const [brushSize, setBrushSize] = useState(() => {
        try {
            const v = parseInt(localStorage.getItem('mtg_penBrushSize'), 10);
            return Number.isFinite(v) && v >= 1 && v <= 12 ? v : 3;
        } catch (_) { return 3; }
    });
    const [tool, setTool] = useState('pen'); // 'pen' | 'eraser'
    const [, forceRerender] = useState(0);
    // Brush preview circle — tracks the cursor while drawing is enabled so the
    // user can see the actual stroke radius before they commit to it.
    const [previewPos, setPreviewPos] = useState(null);

    // Persist color + brush size on change.
    useEffect(() => {
        try { localStorage.setItem('mtg_penColor', color); } catch (_) {}
        // Notify parent so it can push an immediate cursorMove with the new
        // color — otherwise the color change only lands on other clients on
        // the next mouse move.
        onPenColorChange?.(color);
    }, [color, onPenColorChange]);
    useEffect(() => {
        try { localStorage.setItem('mtg_penBrushSize', String(brushSize)); } catch (_) {}
    }, [brushSize]);

    const colors = [
        '#ff0000', '#ff4488', '#ff8800', '#ffcc00', '#ffff00',
        '#88ff00', '#00ff00', '#00ffaa', '#00ffff', '#0088ff',
        '#0044ff', '#8800ff', '#ff00ff', '#ffffff', '#888888', '#000000',
    ];

    // Merge server drawings + local strokes (deduped by strokeId), minus any
    // strokes we've locally erased but haven't heard the server confirm yet.
    const getAllStrokes = useCallback(() => {
        const serverIds = new Set((drawings || []).map(d => d.strokeId));
        const localOnly = localStrokesRef.current.filter(s => !serverIds.has(s.strokeId));
        const erased = localErasedRef.current;
        return [...(drawings || []), ...localOnly].filter(s => !erased.has(s.strokeId));
    }, [drawings]);

    // Once server confirms our local stroke, drop it from local cache. Also
    // clear any locally-erased entries that have now disappeared from the
    // server's authoritative list.
    useEffect(() => {
        if (!drawings) return;
        const serverIds = new Set(drawings.map(d => d.strokeId));
        localStrokesRef.current = localStrokesRef.current.filter(s => !serverIds.has(s.strokeId));
        // If a locally-erased stroke is no longer in the server list, we can
        // forget about it — it was confirmed deleted.
        for (const id of Array.from(localErasedRef.current)) {
            if (!serverIds.has(id)) localErasedRef.current.delete(id);
        }
    }, [drawings]);

    // Given the canvas dimensions and a stroke's aspect ratio (from the
    // drawer's canvas at record time), compute a "draw rectangle" — the
    // largest rectangle of that aspect ratio that fits centered inside the
    // current canvas. Strokes are rendered inside this rectangle so shapes
    // stay geometrically true regardless of the viewer's canvas shape.
    //
    // If the stroke has no aspectRatio (legacy strokes from before this
    // feature, or the in-progress local stroke rendered on its own canvas),
    // we fall back to the full canvas — same as the old per-axis behavior.
    const computeStrokeRect = (canvasW, canvasH, strokeAR) => {
        if (!strokeAR || !isFinite(strokeAR) || strokeAR <= 0) {
            return { offsetX: 0, offsetY: 0, rectW: canvasW, rectH: canvasH };
        }
        const canvasAR = canvasW / canvasH;
        let rectW, rectH;
        if (canvasAR > strokeAR) {
            // Canvas is wider than the stroke's native shape → bars on sides.
            rectH = canvasH;
            rectW = rectH * strokeAR;
        } else {
            // Canvas is taller than the stroke's native shape → bars top/bottom.
            rectW = canvasW;
            rectH = rectW / strokeAR;
        }
        return {
            offsetX: (canvasW - rectW) / 2,
            offsetY: (canvasH - rectH) / 2,
            rectW,
            rectH,
        };
    };

    // Stroke points are stored as normalized 0-1 coordinates relative to the
    // drawer's canvas, plus the drawer's aspect ratio. On render we map them
    // into a letterboxed rect that preserves that aspect ratio.
    const drawStroke = (ctx, stroke) => {
        if (!stroke.points || stroke.points.length < 1) return;
        const { offsetX, offsetY, rectW, rectH } = computeStrokeRect(
            ctx.canvas.width,
            ctx.canvas.height,
            stroke.aspectRatio,
        );
        ctx.beginPath();
        ctx.strokeStyle = stroke.color || '#ff0000';
        ctx.lineWidth = stroke.size || 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const px = (p) => ({ x: offsetX + p.x * rectW, y: offsetY + p.y * rectH });
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

    // Mirror current pen state (enabled + color + tool) into the parent's
    // shared ref so GameBoard's cursor broadcaster can tag outgoing cursorMove
    // events with the user's active brush color. Writing to a ref instead of
    // state avoids triggering re-renders just to update the cursor tint.
    useEffect(() => {
        if (penStateRef) {
            penStateRef.current = { enabled: !!enabled, color, tool };
        }
    }, [enabled, color, tool, penStateRef]);

    // Listen for incoming strokes + erase events from other players via socket
    useEffect(() => {
        const onNewStroke = (stroke) => {
            // The newStroke event comes from another player. Add it to local cache so it appears
            // immediately, then it'll be in the next gameState broadcast too.
            localStrokesRef.current.push(stroke);
            forceRerender(n => n + 1);
        };
        const onErased = ({ strokeIds }) => {
            if (!Array.isArray(strokeIds)) return;
            for (const id of strokeIds) localErasedRef.current.add(id);
            // Also strip from local cache so uncommitted strokes that got
            // erased by someone else vanish immediately.
            localStrokesRef.current = localStrokesRef.current.filter(s => !strokeIds.includes(s.strokeId));
            forceRerender(n => n + 1);
        };
        socket.on('newStroke', onNewStroke);
        socket.on('erasedStrokes', onErased);
        return () => {
            socket.off('newStroke', onNewStroke);
            socket.off('erasedStrokes', onErased);
        };
    }, []);

    // Hit-test: does the eraser cursor (given as 0-1 local canvas coords)
    // fall within `tolerance` pixels of any segment of the stroke? The stroke
    // is rendered in a letterboxed rectangle matching its own aspect ratio,
    // so we have to project stroke points into the same pixel space the
    // renderer uses — not just multiply by canvas width/height directly.
    const strokeHit = useCallback((stroke, nx, ny, tolerancePx) => {
        const canvas = canvasRef.current;
        if (!canvas || !stroke.points || stroke.points.length === 0) return false;
        const w = canvas.width;
        const h = canvas.height;
        // Eraser cursor position in pixel space (relative to our own canvas).
        const px = nx * w;
        const py = ny * h;
        // Stroke-specific draw rectangle (matches the renderer's math so the
        // hit region always aligns with what the user actually sees).
        const { offsetX, offsetY, rectW, rectH } = computeStrokeRect(w, h, stroke.aspectRatio);
        const toPixelX = (p) => offsetX + p.x * rectW;
        const toPixelY = (p) => offsetY + p.y * rectH;
        // Combine stroke's own thickness with the eraser tolerance so thicker
        // strokes are easier to catch.
        const radius = tolerancePx + (stroke.size || 3) / 2;
        const r2 = radius * radius;
        const pts = stroke.points;
        if (pts.length === 1) {
            const dx = toPixelX(pts[0]) - px;
            const dy = toPixelY(pts[0]) - py;
            return dx * dx + dy * dy <= r2;
        }
        for (let i = 1; i < pts.length; i++) {
            const ax = toPixelX(pts[i - 1]), ay = toPixelY(pts[i - 1]);
            const bx = toPixelX(pts[i]), by = toPixelY(pts[i]);
            const dx = bx - ax, dy = by - ay;
            const lenSq = dx * dx + dy * dy;
            let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
            t = Math.max(0, Math.min(1, t));
            const cx = ax + t * dx, cy = ay + t * dy;
            const ex = cx - px, ey = cy - py;
            if (ex * ex + ey * ey <= r2) return true;
        }
        return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // When in eraser mode, find strokes under the cursor and mark them for
    // deletion. Batches by push-to-localErasedRef so the UI updates instantly,
    // then emits a single eraseStrokes event per batch.
    const eraserHitAt = useCallback((nx, ny) => {
        const tolerancePx = Math.max(8, brushSize * 3);
        const hits = [];
        for (const stroke of getAllStrokes()) {
            if (!stroke.strokeId) continue;
            if (localErasedRef.current.has(stroke.strokeId)) continue;
            if (strokeHit(stroke, nx, ny, tolerancePx)) {
                hits.push(stroke.strokeId);
            }
        }
        if (hits.length > 0) {
            for (const id of hits) localErasedRef.current.add(id);
            socket.emit('eraseStrokes', { strokeIds: hits }, () => {});
            forceRerender(n => n + 1);
        }
    }, [getAllStrokes, strokeHit, brushSize]);

    // Returns normalized 0-1 coordinates relative to canvas size. Accepts either
    // a mouse event (clientX/clientY) or a touch event (first changedTouch).
    const getPos = (clientX, clientY) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left) / rect.width,
            y: (clientY - rect.top) / rect.height,
        };
    };

    const beginStroke = (clientX, clientY) => {
        if (!enabled) return;
        const pos = getPos(clientX, clientY);
        if (tool === 'eraser') {
            // Eraser is stateless — just hit-test at the cursor. We still set
            // isDrawingRef so move events continue erasing until pointer up.
            isDrawingRef.current = true;
            eraserHitAt(pos.x, pos.y);
            return;
        }
        isDrawingRef.current = true;
        currentStrokeRef.current = [pos];
        forceRerender(n => n + 1);
    };

    const extendStroke = (clientX, clientY) => {
        if (!isDrawingRef.current) return;
        const pos = getPos(clientX, clientY);
        if (tool === 'eraser') {
            eraserHitAt(pos.x, pos.y);
            return;
        }
        currentStrokeRef.current.push(pos);
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

    const endStroke = () => {
        if (!isDrawingRef.current) return;
        isDrawingRef.current = false;
        if (tool === 'eraser') {
            // Nothing to emit — individual eraseStrokes calls already went out
            // during pointer movement.
            return;
        }
        const points = currentStrokeRef.current;
        if (points.length > 0) {
            const strokeId = Date.now().toString(36) + Math.random().toString(36).slice(2);
            // Capture the current canvas aspect ratio so receivers can render
            // the stroke in a letterboxed rect of the same shape. Points are
            // 0-1 normalized against the local canvas as before.
            const canvas = canvasRef.current;
            const aspectRatio = canvas ? canvas.width / canvas.height : undefined;
            const stroke = { strokeId, points: [...points], color, size: brushSize, aspectRatio };
            // Add to local cache immediately so it stays visible
            localStrokesRef.current.push(stroke);
            socket.emit('drawStroke', stroke);
        }
        currentStrokeRef.current = [];
        forceRerender(n => n + 1);
    };

    const handleMouseDown = (e) => {
        if (e.button !== 0) return;
        beginStroke(e.clientX, e.clientY);
    };
    const handleMouseMove = (e) => {
        if (enabled) {
            const canvas = canvasRef.current;
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                setPreviewPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            }
        }
        extendStroke(e.clientX, e.clientY);
    };
    const handleMouseLeaveCanvas = () => { endStroke(); setPreviewPos(null); };
    const handleMouseUp = () => endStroke();

    // Touch handlers are attached as native listeners (not React synthetic events)
    // because React attaches touch listeners as passive, so we can't preventDefault
    // the page scroll/zoom while drawing. Also guard against multi-touch so
    // pinch-zoom gestures still work when drawing is disabled.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const onTouchStart = (e) => {
            if (!enabled) return;
            if (e.touches.length !== 1) {
                // Multi-touch: abandon any in-progress stroke so the user can e.g. pinch-zoom.
                if (isDrawingRef.current) {
                    isDrawingRef.current = false;
                    currentStrokeRef.current = [];
                    forceRerender(n => n + 1);
                }
                return;
            }
            e.preventDefault();
            const t = e.touches[0];
            beginStroke(t.clientX, t.clientY);
        };
        const onTouchMove = (e) => {
            if (!isDrawingRef.current) return;
            if (e.touches.length !== 1) return;
            e.preventDefault();
            const t = e.touches[0];
            extendStroke(t.clientX, t.clientY);
        };
        const onTouchEnd = (e) => {
            if (!isDrawingRef.current) return;
            e.preventDefault();
            endStroke();
        };

        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd, { passive: false });
        canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
        return () => {
            canvas.removeEventListener('touchstart', onTouchStart);
            canvas.removeEventListener('touchmove', onTouchMove);
            canvas.removeEventListener('touchend', onTouchEnd);
            canvas.removeEventListener('touchcancel', onTouchEnd);
        };
    // beginStroke/extendStroke/endStroke close over current tool+color+brushSize+enabled;
    // rebind when any of those change so handlers see current values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, color, brushSize, tool]);

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
                onMouseLeave={handleMouseLeaveCanvas}
                style={{
                    pointerEvents: enabled ? 'auto' : 'none',
                    // When drawing is enabled, block browser's default gesture handling
                    // (page scroll, pinch-zoom) so strokes aren't eaten by scrolling.
                    touchAction: enabled ? 'none' : 'auto',
                }}
            />
            {/* Brush preview circle — follows the cursor while pen/eraser is
                active so the user sees the actual radius before they commit. */}
            {enabled && previewPos && (
                <div
                    className="brush-preview"
                    style={{
                        left: previewPos.x - brushSize,
                        top: previewPos.y - brushSize,
                        width: brushSize * 2,
                        height: brushSize * 2,
                        borderColor: tool === 'eraser' ? '#ffffff' : color,
                    }}
                />
            )}
            {enabled && (
                <div className="drawing-toolbar">
                    <div className="tool-picker">
                        <button
                            className={`tool-btn ${tool === 'pen' ? 'active' : ''}`}
                            onClick={() => setTool('pen')}
                            title="Pen"
                            type="button"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 19l7-7 3 3-7 7-3-3z" />
                                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                            </svg>
                        </button>
                        <button
                            className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`}
                            onClick={() => setTool('eraser')}
                            title="Eraser"
                            type="button"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 17l6 6 12-12-6-6-12 12z" />
                                <path d="M9 23l12-12" />
                            </svg>
                        </button>
                    </div>
                    <div className="color-picker">
                        {colors.map(c => (
                            <button
                                key={c}
                                className={`color-swatch ${color === c ? 'active' : ''}`}
                                style={{ background: c }}
                                onClick={() => { setColor(c); setTool('pen'); }}
                                disabled={tool === 'eraser'}
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
            {!hideToggle && (
                <button className={`drawing-toggle ${enabled ? 'active' : ''}`} onClick={onToggle} title="Toggle drawing">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 19l7-7 3 3-7 7-3-3z" />
                        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                        <path d="M2 2l7.586 7.586" />
                        <circle cx="11" cy="11" r="2" />
                    </svg>
                </button>
            )}
        </div>
    );
}
