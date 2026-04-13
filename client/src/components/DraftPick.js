import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import socket from '../socket';
import { useEscapeKey } from '../utils';

/**
 * Draft pick interface with pack opening animation.
 * Shows the current pack, lets the player pick a card, tracks all picks.
 */
export default function DraftPick({ pack, round, pickNumber, totalRounds, picks, isNewPack, setCode, onMaximize }) {
    const [selectedIdx, setSelectedIdx] = useState(null);
    const [waiting, setWaiting] = useState(false);
    const [opening, setOpening] = useState(false);
    const [revealed, setRevealed] = useState(false);
    const [hover, setHover] = useState(null); // { imageUri, x, y }

    // When a new pack arrives, reset state
    useEffect(() => {
        setSelectedIdx(null);
        setWaiting(false);
        if (isNewPack) {
            // Show pack opening animation for new rounds
            setOpening(true);
            setRevealed(false);
            const timer = setTimeout(() => {
                setOpening(false);
                setRevealed(true);
            }, 1500);
            return () => clearTimeout(timer);
        } else {
            // Passed pack — show cards immediately
            setOpening(false);
            setRevealed(true);
        }
    }, [pack, isNewPack]);

    useEscapeKey(() => setSelectedIdx(null));

    const confirmPick = useCallback(() => {
        if (selectedIdx === null || !pack || waiting) return;
        socket.emit('draft:pick', { cardIndex: selectedIdx });
        setWaiting(true);
    }, [selectedIdx, pack, waiting]);

    if (!pack || pack.length === 0) {
        return (
            <div className="draft-pick-panel">
                <div className="draft-waiting">
                    <div className="muted">Waiting for next pack...</div>
                </div>
            </div>
        );
    }

    const direction = round % 2 === 0 ? 'left' : 'right';
    const dirArrow = direction === 'left' ? '\u2190' : '\u2192';
    const packSize = pack.length;
    const totalPicksInRound = packSize + pickNumber;
    const setIconUrl = setCode ? `https://svgs.scryfall.io/sets/${setCode.toLowerCase()}.svg` : null;

    // Pack opening animation
    if (opening) {
        return (
            <div className="draft-pick-panel">
                <div className="draft-pack-opening">
                    <div className="draft-pack-wrapper">
                        {setIconUrl && <img src={setIconUrl} alt="" className="draft-pack-art" />}
                        <div className="draft-pack-label">Pack {round + 1}</div>
                        <div className="draft-pack-shimmer" />
                    </div>
                    <div className="draft-opening-text">Opening pack...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="draft-pick-panel">
            {/* Header — round/pick info + pass direction */}
            <div className="draft-pick-header">
                <div className="draft-pick-info">
                    {setIconUrl && <img src={setIconUrl} alt="" className="draft-header-icon" />}
                    <h3>Pack {round + 1} of {totalRounds}</h3>
                    <span className="draft-pick-num">Pick {pickNumber + 1} of {totalPicksInRound}</span>
                </div>
                <div className="draft-pass-indicator">
                    <span className="draft-pass-dir">{dirArrow} Passing {direction}</span>
                    <span className="draft-cards-left">{packSize} cards in pack</span>
                </div>
            </div>

            {waiting ? (
                <div className="draft-waiting">
                    <div className="draft-waiting-text">Waiting for other players to pick...</div>
                    {picks && picks.length > 0 && (
                        <div className="draft-picks-summary">
                            <strong>Your picks ({picks.length})</strong>
                            <div className="draft-picks-grid">
                                {picks.map((c, i) => (
                                    <div key={i} className="draft-pick-thumb" title={c.name} onClick={() => onMaximize?.(c)}>
                                        {c.imageUri && <img src={c.imageUri.replace('/normal/', '/small/')} alt={c.name} />}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <>
                    {/* Pack cards — grid of selectable cards */}
                    <div className={`draft-pack-grid ${revealed ? 'revealed' : ''}`}>
                        {pack.map((card, i) => (
                            <div
                                key={card.scryfallId || i}
                                className={`draft-pack-card ${selectedIdx === i ? 'selected' : ''}`}
                                style={{ animationDelay: revealed ? `${i * 40}ms` : '0ms' }}
                                onClick={() => setSelectedIdx(i)}
                                onDoubleClick={() => { setSelectedIdx(i); setTimeout(() => { socket.emit('draft:pick', { cardIndex: i }); setWaiting(true); }, 0); }}
                                onMouseMove={(e) => card.imageUri && setHover({ imageUri: card.imageUri, x: Math.min(e.clientX + 16, window.innerWidth - 340), y: Math.max(10, Math.min(e.clientY - 40, window.innerHeight - 460)) })}
                                onMouseLeave={() => setHover(null)}
                            >
                                {card.imageUri ? (
                                    <img src={card.imageUri} alt={card.name} />
                                ) : (
                                    <div className="draft-card-name">{card.name}</div>
                                )}
                                <div className={`draft-card-rarity rarity-${card.rarity}`}>{card.rarity?.[0]?.toUpperCase()}</div>
                            </div>
                        ))}
                    </div>

                    {/* Pick button */}
                    <div className="draft-pick-actions">
                        <button
                            className="primary-btn"
                            onClick={confirmPick}
                            disabled={selectedIdx === null}
                        >
                            {selectedIdx !== null ? `Pick: ${pack[selectedIdx]?.name}` : 'Select a card to pick'}
                        </button>
                    </div>

                    {/* Picks so far — collapsible strip at bottom */}
                    {picks && picks.length > 0 && (
                        <div className="draft-picks-summary">
                            <strong>Your picks ({picks.length})</strong>
                            <div className="draft-picks-grid">
                                {picks.map((c, i) => (
                                    <div key={i} className="draft-pick-thumb" title={c.name} onClick={() => onMaximize?.(c)}>
                                        {c.imageUri && <img src={c.imageUri.replace('/normal/', '/small/')} alt={c.name} />}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Hover zoom portal */}
            {hover && hover.imageUri && createPortal(
                <div className="card-zoom" style={{ position: 'fixed', left: hover.x, top: hover.y, zIndex: 3000, pointerEvents: 'none' }}>
                    <img src={hover.imageUri} alt="" />
                </div>,
                document.body
            )}
        </div>
    );
}
