import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import socket from '../socket';
import { scryfall } from '../api';
import { useEscapeKey } from '../utils';
import ManaCost, { OracleText } from './ManaCost';
import { detectKeywords } from '../keywords';

const CARD_BACK = 'https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg';

export default function CardMaximized({ card, onClose, onClickCard, onAddNote, onAddCounter, allPlayers, userId, currentZone, readOnly, attachedToName, attachments, loadedDeckId }) {
    useEscapeKey(onClose);
    const [hoverThumb, setHoverThumb] = useState(null); // { url, x, y }
    const [showRevealMenu, setShowRevealMenu] = useState(false);
    const [showMoveMenu, setShowMoveMenu] = useState(false);
    const [viewingBack, setViewingBack] = useState(false);
    const [skinInput, setSkinInput] = useState('');
    const [showSkinInput, setShowSkinInput] = useState(false);
    const [altArts, setAltArts] = useState(null); // null = not loaded, [] = empty
    const [loadingArts, setLoadingArts] = useState(false);

    const currentSkin = card?.skinUrl || null;

    const loadAltArts = async () => {
        if (altArts !== null || !card?.name) return;
        setLoadingArts(true);
        try {
            // Strip DFC back-face name if present
            const name = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
            const res = await scryfall.prints(name);
            const arts = (res?.data || [])
                .filter(c => c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal)
                .map(c => ({
                    id: c.id,
                    set: c.set_name,
                    setCode: c.set?.toUpperCase(),
                    cn: c.collector_number,
                    imageUri: c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal,
                }));
            setAltArts(arts);
        } catch (_) {
            setAltArts([]);
        }
        setLoadingArts(false);
    };

    const applySkin = (url, allCopies) => {
        if (allCopies && card.scryfallId) {
            socket.emit('setCardSkinAll', { scryfallId: card.scryfallId, skinUrl: url });
            // Also save to deck so it persists across games
            if (loadedDeckId) {
                socket.emit('saveSkinToDeck', { deckId: loadedDeckId, scryfallId: card.scryfallId, skinUrl: url });
            }
        } else {
            socket.emit('setCardSkin', { instanceId: card.instanceId, skinUrl: url });
        }
    };

    const saveSkinToDeck = () => {
        if (!loadedDeckId || !card.scryfallId || !currentSkin) return;
        socket.emit('saveSkinToDeck', { deckId: loadedDeckId, scryfallId: card.scryfallId, skinUrl: currentSkin }, (res) => {
            if (res?.success) {
                // brief visual feedback would be nice but keeping it simple
            }
        });
    };
    if (!card) return null;

    const hasDFC = !!card.backImageUri;
    const isFaceDown = card.faceDown;
    const isFlipped = card.flipped && hasDFC;
    // Determine which side is currently shown in-game
    const gameShowsBack = isFlipped;
    // The local preview toggle lets the user peek at whichever side ISN'T
    // currently shown, without mutating game state.
    const showBack = viewingBack ? !gameShowsBack : gameShowsBack;
    const imageUrl = isFaceDown
        ? CARD_BACK
        : showBack
            ? card.backImageUri
            : (card.imageUri || card.customImageUrl || CARD_BACK);

    const largeUrl = imageUrl.replace('/normal/', '/large/').replace('/small/', '/large/');
    const hasNotes = Array.isArray(card.notes) && card.notes.length > 0;
    const counterEntries = Object.entries(card.counters || {}).filter(([, v]) => v !== 0);
    const detectedKeywords = !isFaceDown ? detectKeywords(card) : [];

    const handleThumbHover = (e, imageUri) => {
        if (!imageUri) return;
        const x = e.clientX > window.innerWidth / 2 ? e.clientX - 340 : e.clientX + 20;
        const y = Math.max(10, Math.min(e.clientY - 60, window.innerHeight - 460));
        setHoverThumb({ url: imageUri, x, y });
    };

    // Portal to body with an elevated z-index so the maximized card always
    // renders ABOVE any other modal — e.g. if you click a card in the tutor
    // / library search, the zoomed view appears on top of that modal instead
    // of behind it.
    return createPortal(
        <div className="modal-overlay card-max-overlay">
            <div className="card-maximized">
                <div className={`card-max-image-wrap ${card.foil && !isFaceDown ? 'foil' : ''}`}>
                    <img src={largeUrl} alt={card.name} />
                    {hasDFC && !isFaceDown && (
                        <button
                            className="card-max-flip-preview"
                            onClick={() => setViewingBack(v => !v)}
                            title={viewingBack ? 'View front side' : 'View other side'}
                            type="button"
                        >
                            {viewingBack ? '↩ Front' : '↪ Other side'}
                        </button>
                    )}
                </div>
                <div className="card-max-info">
                    <h3>{card.name}</h3>
                    {card.isCustom && (
                        <p className="custom-author-line">
                            Custom card{card.customCardAuthorUsername ? ` · by ${card.customCardAuthorUsername}` : ''}
                        </p>
                    )}
                    {card.manaCost && <div className="mana-cost"><ManaCost cost={card.manaCost} /></div>}
                    <p className="type-line">{card.typeLine}</p>
                    {card.oracleText && <p className="oracle-text"><OracleText text={card.oracleText} /></p>}
                    {(card.power || card.toughness) && <p className="pt">{card.power}/{card.toughness}</p>}
                    {detectedKeywords.length > 0 && (
                        <div className="card-effects-section">
                            <div className="card-effects-section-head"><strong>Keywords</strong></div>
                            {detectedKeywords.map(({ keyword, description }) => (
                                <div key={keyword} className="keyword-effect">
                                    <span className="keyword-name">{keyword.replace(/\b\w/g, c => c.toUpperCase())}</span>
                                    <span className="keyword-desc">{description}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {counterEntries.length > 0 && (
                        <div className="card-effects-section">
                            <div className="card-effects-section-head">
                                <strong>Counters</strong>
                                {card.instanceId && !readOnly && (
                                    <button
                                        className="small-btn"
                                        onClick={() => socket.emit('clearCardCounters', { instanceId: card.instanceId })}
                                    >Clear all</button>
                                )}
                            </div>
                            {counterEntries.map(([name, val]) => (
                                <div key={name} className="counter-line-max">
                                    <span>· <strong>{name}</strong> × {val}</span>
                                    {card.instanceId && !readOnly && (
                                        <span className="counter-line-actions">
                                            <button
                                                className="counter-step-btn"
                                                title="Decrement"
                                                onClick={() => socket.emit('setCardCounter', { instanceId: card.instanceId, counter: name, value: val - 1 })}
                                            >−</button>
                                            <button
                                                className="counter-step-btn"
                                                title="Increment"
                                                onClick={() => socket.emit('setCardCounter', { instanceId: card.instanceId, counter: name, value: val + 1 })}
                                            >+</button>
                                            <button
                                                className="note-remove-btn"
                                                title="Remove counter"
                                                onClick={() => socket.emit('setCardCounter', { instanceId: card.instanceId, counter: name, value: 0 })}
                                            >×</button>
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {hasNotes && (
                        <div className="card-effects-section">
                            <strong>Effects / Notes</strong>
                            {card.notes.map((note, i) => {
                                const noteObj = typeof note === 'string' ? { text: note, card: null } : note;
                                return (
                                    <div key={i} className="note-line-max">
                                        {noteObj.card?.imageUri && (
                                            <img
                                                src={noteObj.card.imageUri}
                                                alt={noteObj.card.name}
                                                className="note-attached-thumb"
                                                onMouseMove={(e) => handleThumbHover(e, noteObj.card.imageUri)}
                                                onMouseLeave={() => setHoverThumb(null)}
                                            />
                                        )}
                                        <span className="note-text"><OracleText text={noteObj.text} /></span>
                                        {card.instanceId && !readOnly && (
                                            <button
                                                className="note-remove-btn"
                                                title="Remove note"
                                                onClick={() => socket.emit('removeCardNote', { instanceId: card.instanceId, index: i })}
                                            >×</button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {/* Attachment info — shows what this card is equipped to,
                        or what equipment/auras are attached to this card. */}
                    {attachedToName && (
                        <div className="card-effects-section">
                            <strong>Attached to</strong>
                            <div className="note-line-max">
                                <span className="note-text">🔗 {attachedToName}</span>
                            </div>
                        </div>
                    )}
                    {Array.isArray(attachments) && attachments.length > 0 && (
                        <div className="card-effects-section">
                            <strong>Equipped / Enchanted by</strong>
                            {attachments.map((att, i) => (
                                <div key={i} className="note-line-max">
                                    {att.imageUri && (
                                        <img
                                            src={att.imageUri}
                                            alt={att.name}
                                            className="note-attached-thumb"
                                            onMouseMove={(e) => handleThumbHover(e, att.imageUri)}
                                            onMouseLeave={() => setHoverThumb(null)}
                                        />
                                    )}
                                    <span className="note-text">🔗 {att.name}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {card.instanceId && !readOnly && (
                        <div className="card-max-actions">
                            {/* Quick actions row */}
                            <div className="card-max-action-row">
                                <button className="small-btn" onClick={() => socket.emit('tapCard', { instanceId: card.instanceId })}>
                                    {card.tapped ? 'Untap' : 'Tap'}
                                </button>
                                <button
                                    className="small-btn"
                                    onClick={() => socket.emit(
                                        card.backImageUri ? 'flipCard' : 'toggleFaceDown',
                                        { instanceId: card.instanceId },
                                    )}
                                    title="Flip — swaps sides on double-faced cards, otherwise toggles face-down"
                                >
                                    Flip
                                </button>
                                {onAddCounter && (
                                    <button className="small-btn" onClick={() => onAddCounter(card)}>+ Counter</button>
                                )}
                                {onAddNote && (
                                    <button className="small-btn" onClick={() => onAddNote(card.instanceId)}>+ Note</button>
                                )}
                                <button
                                    className={`small-btn ${card.foil ? 'foil-active' : ''}`}
                                    onClick={() => socket.emit('setCardField', { instanceId: card.instanceId, field: 'foil', value: !card.foil })}
                                    title={card.foil ? 'Remove foil' : 'Make foil'}
                                >
                                    {card.foil ? '\u2726 Foil' : '\u2727 Foil'}
                                </button>
                            </div>

                            {/* Move card to a different zone */}
                            {currentZone && (
                                <div className="card-max-action-row">
                                    <span className="card-max-action-label">Move to:</span>
                                    {['hand', 'battlefield', 'graveyard', 'exile', 'commandZone', 'library'].filter(z => z !== currentZone).map(z => (
                                        <button key={z} className="small-btn" onClick={() => {
                                            socket.emit('moveCard', { instanceId: card.instanceId, fromZone: currentZone, toZone: z });
                                            onClose?.();
                                        }}>
                                            {z === 'commandZone' ? 'Cmd' : z === 'battlefield' ? 'BF' : z === 'graveyard' ? 'GY' : z.charAt(0).toUpperCase() + z.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Reveal */}
                            {allPlayers && (
                                <div className="card-max-action-row">
                                    <span className="card-max-action-label">Reveal:</span>
                                    <button className="small-btn" onClick={() => socket.emit('revealCard', { instanceId: card.instanceId, targetPlayerIds: 'all' })}>To all</button>
                                    {!showRevealMenu && allPlayers.filter(p => p.userId !== userId).length > 0 && (
                                        <button className="small-btn" onClick={() => setShowRevealMenu(true)}>To specific...</button>
                                    )}
                                    {showRevealMenu && allPlayers.filter(p => p.userId !== userId).map(p => (
                                        <button key={p.userId} className="small-btn" onClick={() => {
                                            socket.emit('revealCard', { instanceId: card.instanceId, targetPlayerIds: [p.userId] });
                                            setShowRevealMenu(false);
                                        }}>{p.username}</button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Custom skin — change art from Scryfall printings or a custom URL.
                        Visible to all players. */}
                    {card.instanceId && (
                        <div className="card-skin-section">
                            <div className="card-skin-header">
                                <strong>Card art</strong>
                            </div>
                            {currentSkin && (
                                <div className="card-skin-actions">
                                    <button className="small-btn" onClick={() => applySkin(null, false)}>Reset this card</button>
                                    {card.scryfallId && (
                                        <button className="small-btn" onClick={() => applySkin(null, true)}>Reset all copies</button>
                                    )}
                                    {loadedDeckId && card.scryfallId && (
                                        <button className="small-btn primary-btn" onClick={saveSkinToDeck}>Save to deck</button>
                                    )}
                                </div>
                            )}

                            {/* Alternate printings from Scryfall */}
                            {altArts === null ? (
                                <button className="small-btn" onClick={loadAltArts} disabled={loadingArts}>
                                    {loadingArts ? 'Loading...' : 'Browse alternate art'}
                                </button>
                            ) : altArts.length > 0 ? (
                                <div className="card-skin-gallery">
                                    {altArts.map(art => (
                                        <div
                                            key={art.id}
                                            className={`card-skin-thumb ${currentSkin === art.imageUri ? 'active' : ''}`}
                                            onClick={() => applySkin(art.imageUri, false)}
                                            title={`${art.set} (${art.setCode}) #${art.cn}\nClick = this card · Shift+click = all copies + save to deck`}
                                            onClickCapture={(e) => {
                                                if (e.shiftKey) {
                                                    e.stopPropagation();
                                                    applySkin(art.imageUri, true);
                                                }
                                            }}
                                            onMouseMove={(e) => handleThumbHover(e, art.imageUri)}
                                            onMouseLeave={() => setHoverThumb(null)}
                                        >
                                            <img src={art.imageUri.replace('/normal/', '/small/')} alt={art.set} />
                                            <span className="card-skin-set">{art.setCode}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="muted" style={{ fontSize: 11 }}>No alternate printings found.</p>
                            )}

                            {/* Custom URL input */}
                            {!showSkinInput ? (
                                <button className="small-btn" onClick={() => setShowSkinInput(true)}>
                                    Custom URL...
                                </button>
                            ) : (
                                <div className="card-skin-url-row">
                                    <input
                                        type="text"
                                        placeholder="Paste any image URL"
                                        value={skinInput}
                                        onChange={e => setSkinInput(e.target.value)}
                                        autoFocus
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && skinInput.trim()) applySkin(skinInput.trim(), false);
                                            if (e.key === 'Escape') setShowSkinInput(false);
                                        }}
                                    />
                                    <button className="small-btn primary-btn" disabled={!skinInput.trim()} onClick={() => applySkin(skinInput.trim(), false)}>Apply</button>
                                    <button className="small-btn" onClick={() => setShowSkinInput(false)}>Cancel</button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <button className="close-btn" onClick={onClose}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            {hoverThumb && createPortal(
                <div className="card-zoom" style={{ position: 'fixed', left: hoverThumb.x, top: hoverThumb.y, zIndex: 3500, pointerEvents: 'none' }}>
                    <img src={hoverThumb.url.replace('/normal/', '/large/').replace('/small/', '/large/')} alt="" />
                </div>,
                document.body
            )}
        </div>,
        document.body
    );
}
