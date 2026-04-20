import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import socket from '../socket';
import { scryfall } from '../api';
import { useEscapeKey } from '../utils';
import ManaCost, { OracleText } from './ManaCost';
import { detectKeywords } from '../keywords';

const CARD_BACK = 'https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg';

export default function CardMaximized({ card, onClose, onClickCard, onAddNote, onAddCounter, allPlayers, userId, currentZone, readOnly, isOwner, attachedToName, attachments, loadedDeckId }) {
    useEscapeKey(onClose);
    const [hoverThumb, setHoverThumb] = useState(null); // { url, x, y }
    const [showRevealMenu, setShowRevealMenu] = useState(false);
    const [showMoveMenu, setShowMoveMenu] = useState(false);
    const [viewingBack, setViewingBack] = useState(false);
    const [skinInput, setSkinInput] = useState('');
    const [showSkinInput, setShowSkinInput] = useState(false);
    const [altArts, setAltArts] = useState(null); // null = not loaded, [] = empty
    const [loadingArts, setLoadingArts] = useState(false);
    // Reload alt-art gallery when the user flips between front/back so the
    // thumbnails reflect the side they're editing.
    const [artsSide, setArtsSide] = useState('front');
    if (!card) return null;

    const hasDFC = !!card.backImageUri;
    const isFaceDown = card.faceDown;
    const isFlipped = card.flipped && hasDFC;
    // Determine which side is currently shown in-game
    const gameShowsBack = isFlipped;
    // The local preview toggle lets the user peek at whichever side ISN'T
    // currently shown, without mutating game state.
    const showBack = viewingBack ? !gameShowsBack : gameShowsBack;
    // The side being edited — all skin / alt-art actions target this side.
    const editingSide = showBack ? 'back' : 'front';
    // skinUrl is the alternate art the owner picked — shown to all players.
    // Front uses skinUrl; back (DFC) uses backSkinUrl.
    const frontImage = (card.skinUrl || card.imageUri || card.customImageUrl || CARD_BACK);
    const backImage = (card.backSkinUrl || card.backImageUri || CARD_BACK);
    const imageUrl = isFaceDown
        ? CARD_BACK
        : showBack
            ? backImage
            : frontImage;
    // Which skin value the UI is currently editing (shown as "active thumb"
    // in the gallery, reset button targets this side, etc.).
    const currentSkin = showBack ? (card.backSkinUrl || null) : (card.skinUrl || null);

    const loadAltArts = async (side = editingSide) => {
        if (!card?.name) return;
        setLoadingArts(true);
        try {
            // Strip DFC back-face name if present
            const name = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
            const res = await scryfall.prints(name);
            // For DFC cards, prints return the whole card; pull the matching
            // face image (0 = front, 1 = back) when available.
            const arts = (res?.data || [])
                .map(c => {
                    const faces = c.card_faces || [];
                    const img = side === 'back'
                        ? (faces[1]?.image_uris?.normal || null)
                        : (c.image_uris?.normal || faces[0]?.image_uris?.normal || null);
                    if (!img) return null;
                    return {
                        id: c.id,
                        set: c.set_name,
                        setCode: c.set?.toUpperCase(),
                        cn: c.collector_number,
                        imageUri: img,
                    };
                })
                .filter(Boolean);
            setAltArts(arts);
            setArtsSide(side);
        } catch (_) {
            setAltArts([]);
            setArtsSide(side);
        }
        setLoadingArts(false);
    };

    const applySkin = (url, allCopies) => {
        const side = editingSide;
        if (allCopies && card.scryfallId) {
            socket.emit('setCardSkinAll', { scryfallId: card.scryfallId, skinUrl: url, side });
            // Also save to deck so it persists across games
            if (loadedDeckId) {
                socket.emit('saveSkinToDeck', {
                    deckId: loadedDeckId,
                    scryfallId: card.scryfallId,
                    [side === 'back' ? 'backSkinUrl' : 'skinUrl']: url,
                });
            }
        } else {
            socket.emit('setCardSkin', { instanceId: card.instanceId, skinUrl: url, side });
        }
    };

    const saveSkinToDeck = () => {
        if (!loadedDeckId || !card.scryfallId) return;
        socket.emit('saveSkinToDeck', {
            deckId: loadedDeckId,
            scryfallId: card.scryfallId,
            [editingSide === 'back' ? 'backSkinUrl' : 'skinUrl']: currentSkin,
        });
    };

    // Save every cosmetic setting (both sides' skins, foil, textless) to
    // the deck so the next game loads them all automatically.
    const saveAllSettingsToDeck = () => {
        if (!loadedDeckId || !card.scryfallId) return;
        socket.emit('saveSkinToDeck', {
            deckId: loadedDeckId,
            scryfallId: card.scryfallId,
            skinUrl: card.skinUrl || null,
            backSkinUrl: card.backSkinUrl || null,
            foil: card.foil || null,
            textless: !!card.textless,
        });
    };

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
                <div className="card-max-image-col">
                    <div className={`card-max-image-wrap ${card.foil && !isFaceDown ? card.foil : ''} ${card.rotated180 && !isFaceDown ? 'rotated-180' : ''}`}>
                        <img src={largeUrl} alt={card.name} />
                    </div>
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
                    {/* Per-face breakdown for multi-face cards. Shown for
                        adventures / splits / flips / aftermaths (where both
                        halves share one image so the individual face text
                        isn't visible) AND for DFCs (useful for textless or
                        non-English back prints where the back side's text
                        isn't readable from the image alone). */}
                    {Array.isArray(card.faces) && card.faces.length >= 2 && (
                        <div className="card-faces-section">
                            <div className="card-effects-section-head">
                                <strong>{card.backImageUri ? 'Card faces' : 'Both halves'}</strong>
                            </div>
                            {card.faces.map((f, i) => (
                                <div key={i} className="card-face-block">
                                    <div className="card-face-head">
                                        <strong>{f.name || `Face ${i + 1}`}</strong>
                                        {f.manaCost && <span className="card-face-cost"><ManaCost cost={f.manaCost} /></span>}
                                    </div>
                                    {f.typeLine && <p className="card-face-type">{f.typeLine}</p>}
                                    {f.oracleText && <p className="card-face-oracle"><OracleText text={f.oracleText} /></p>}
                                    {(f.power || f.toughness) && <p className="card-face-pt">{f.power}/{f.toughness}</p>}
                                </div>
                            ))}
                        </div>
                    )}
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
                                {/* Cosmetic toggles — owner only. Cards in shared piles
                                    or on opponents' sides show read-only visuals. */}
                                {isOwner && (
                                    <>
                                        <button
                                            className={`small-btn ${card.foil ? 'foil-active' : ''}`}
                                            onClick={() => {
                                                const next = !card.foil ? 'foil' : card.foil === 'foil' ? 'etched' : null;
                                                socket.emit('setCardField', { instanceId: card.instanceId, field: 'foil', value: next });
                                            }}
                                            title={!card.foil ? 'Make foil' : card.foil === 'foil' ? 'Switch to etched' : 'Remove effect'}
                                        >
                                            {!card.foil ? '\u2727 Foil' : card.foil === 'foil' ? '\u2726 Foil' : '\u2726 Etched'}
                                        </button>
                                        <button
                                            className={`small-btn ${card.textless ? 'active' : ''}`}
                                            onClick={() => socket.emit('setCardField', { instanceId: card.instanceId, field: 'textless', value: !card.textless })}
                                            title={card.textless ? 'Hide oracle text on hover (card has visible rules text)' : 'Show oracle text on hover (textless / no visible rules)'}
                                        >
                                            {card.textless ? '\u2713 Show text' : 'Show text'}
                                        </button>
                                    </>
                                )}
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
                        Visible to all players but only editable by the card's owner.
                        DFC cards let you edit front and back independently — actions
                        target whichever side is currently showing in the preview. */}
                    {card.instanceId && isOwner && (
                        <div className="card-skin-section">
                            <div className="card-skin-header">
                                <strong>Card art{hasDFC ? ` — ${editingSide} face` : ''}</strong>
                                {hasDFC && (
                                    <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                                        Use "{showBack ? '↩ Front' : '↪ Other side'}" to edit the {showBack ? 'front' : 'back'}.
                                    </span>
                                )}
                            </div>
                            {currentSkin && (
                                <div className="card-skin-actions">
                                    <button className="small-btn" onClick={() => applySkin(null, false)}>Reset {hasDFC ? editingSide : 'this card'}</button>
                                    {card.scryfallId && (
                                        <button className="small-btn" onClick={() => applySkin(null, true)}>Reset all copies</button>
                                    )}
                                    {loadedDeckId && card.scryfallId && (
                                        <button className="small-btn primary-btn" onClick={saveSkinToDeck} title="Save this side's art to the deck">Save {hasDFC ? editingSide : ''} to deck</button>
                                    )}
                                </div>
                            )}
                            {loadedDeckId && card.scryfallId && (
                                <div className="card-skin-actions">
                                    <button
                                        className="small-btn"
                                        onClick={saveAllSettingsToDeck}
                                        title="Save both sides' art, foil, and textless flag to the deck"
                                    >Save all settings to deck</button>
                                </div>
                            )}

                            {/* Alternate printings from Scryfall — gallery reflects the side being edited. */}
                            {altArts === null || artsSide !== editingSide ? (
                                <button className="small-btn" onClick={() => loadAltArts(editingSide)} disabled={loadingArts}>
                                    {loadingArts ? 'Loading...' : `Browse alternate art${hasDFC ? ` (${editingSide})` : ''}`}
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
