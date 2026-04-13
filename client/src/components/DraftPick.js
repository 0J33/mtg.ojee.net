import React, { useState, useEffect } from 'react';
import socket from '../socket';
import { useEscapeKey } from '../utils';

/**
 * Draft pick interface. Shows the current pack, lets the player pick a card.
 * After picking, shows a "waiting" state until all players have picked.
 */
export default function DraftPick({ pack, round, pickNumber, totalRounds, picks, onMaximize }) {
    const [selectedIdx, setSelectedIdx] = useState(null);
    const [waiting, setWaiting] = useState(false);

    // Reset selection when a new pack arrives
    useEffect(() => {
        setSelectedIdx(null);
        setWaiting(false);
    }, [pack]);

    useEscapeKey(() => setSelectedIdx(null));

    const confirmPick = () => {
        if (selectedIdx === null || !pack || waiting) return;
        socket.emit('draft:pick', { cardIndex: selectedIdx });
        setWaiting(true);
    };

    if (!pack || pack.length === 0) {
        return (
            <div className="draft-pick-panel">
                <div className="draft-pick-header">
                    <h3>Waiting for next pack...</h3>
                </div>
            </div>
        );
    }

    const direction = round % 2 === 0 ? '→' : '←';

    return (
        <div className="draft-pick-panel">
            <div className="draft-pick-header">
                <h3>Pack {round + 1}/{totalRounds} · Pick {pickNumber + 1}/{pack.length + (picks?.length > 0 ? 0 : 0)}</h3>
                <span className="muted">Pass {direction} · {pack.length} cards remaining</span>
            </div>

            {waiting ? (
                <div className="draft-waiting">
                    <div className="muted">Waiting for other players to pick...</div>
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
                    <div className="draft-pack-grid">
                        {pack.map((card, i) => (
                            <div
                                key={card.scryfallId || i}
                                className={`draft-pack-card ${selectedIdx === i ? 'selected' : ''}`}
                                onClick={() => setSelectedIdx(i)}
                                onDoubleClick={() => { setSelectedIdx(i); setTimeout(confirmPick, 0); }}
                            >
                                {card.imageUri ? (
                                    <img src={card.imageUri} alt={card.name} />
                                ) : (
                                    <div className="draft-card-name">{card.name}</div>
                                )}
                                <div className="draft-card-rarity">{card.rarity?.[0]?.toUpperCase()}</div>
                            </div>
                        ))}
                    </div>

                    <div className="draft-pick-actions">
                        <button
                            className="primary-btn"
                            onClick={confirmPick}
                            disabled={selectedIdx === null}
                        >
                            {selectedIdx !== null ? `Pick: ${pack[selectedIdx]?.name}` : 'Select a card'}
                        </button>
                    </div>

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
        </div>
    );
}
