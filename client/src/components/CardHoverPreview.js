import React from 'react';
import { createPortal } from 'react-dom';
import ManaCost, { OracleText } from './ManaCost';
import { detectKeywords } from '../keywords';
import { hasRealBack } from '../cardFaces';

/*
 * Shared hover preview for cards — the 320×460 zoom image + side
 * effects panel (keywords, counters, notes, multi-face breakdown,
 * attachments). Used by board cards, pile cards, and anywhere else
 * that wants the full preview. Called with a card and a position; the
 * caller (a trigger element) provides onMouseEnter/Move/Leave to
 * compute where to anchor via useCardHoverAnchor below.
 *
 * pos shape: { x, y, fromBottom }. When fromBottom is true, we anchor
 * the wrapper's BOTTOM at y so tall panels grow upward instead of
 * clipping off the viewport bottom.
 */
export default function CardHoverPreview({ card, pos, attachedToName, attachments }) {
    if (!card || !pos) return null;
    if (card.faceDown) return null;

    const CARD_BACK = 'https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg';
    const hasBack = hasRealBack(card);
    const isFlipped = !!card.flipped && hasBack;
    const frontImage = card.skinUrl || card.imageUri || card.customImageUrl || CARD_BACK;
    const backImage = card.backSkinUrl || card.backImageUri;
    const imageUrl = isFlipped ? backImage : frontImage;
    const largeImageUrl = (imageUrl || CARD_BACK).replace('/normal/', '/large/').replace('/small/', '/large/');

    const counterEntries = Object.entries(card.counters || {});
    const hasCounters = counterEntries.length > 0;
    const hasNotes = Array.isArray(card.notes) && card.notes.length > 0;
    const detectedKeywords = detectKeywords(card);
    const hasKeywords = detectedKeywords.length > 0;
    const attached = !!card.attachedTo;
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    const showOracleFallback = (!!card.textless || !!card.nonEnglish) && !!card.oracleText;
    const multiFaces = Array.isArray(card.faces) && card.faces.length >= 2 ? card.faces : null;
    const showFaces = !!multiFaces && (!hasBack || !!card.nonEnglish || !!card.textless);
    const hasAttachInfo = (attached && !!attachedToName) || hasAttachments;
    const hasEffects = hasCounters || hasNotes || hasAttachInfo;
    const showSidePanel = hasEffects || hasKeywords || showOracleFallback || showFaces;

    return createPortal(
        <div
            className={`card-zoom-wrapper ${pos.fromBottom ? 'anchor-bottom' : ''}`}
            style={pos.fromBottom
                ? { left: pos.x, bottom: pos.y }
                : { left: pos.x, top: pos.y }}
        >
            <div className={`card-zoom ${card.foil || ''}`}>
                <img src={largeImageUrl} alt={card.name} />
            </div>
            {showSidePanel && (
                <div className="card-effects-panel">
                    {showOracleFallback && !showFaces && (
                        <div className="effect-group hover-oracle-group">
                            {card.typeLine && <div className="hover-type-line">{card.typeLine}</div>}
                            <div className="hover-oracle"><OracleText text={card.oracleText} /></div>
                            {(card.power || card.toughness) && <div className="hover-pt">{card.power}/{card.toughness}</div>}
                        </div>
                    )}
                    {showFaces && (
                        <div className="effect-group hover-faces-group">
                            {multiFaces.map((f, i) => (
                                <div key={i} className="hover-face">
                                    <div className="hover-face-head">
                                        <strong>{f.name || `Face ${i + 1}`}</strong>
                                        {f.manaCost && <span className="hover-face-cost"><ManaCost cost={f.manaCost} /></span>}
                                    </div>
                                    {f.typeLine && <div className="hover-type-line">{f.typeLine}</div>}
                                    {f.oracleText && <div className="hover-oracle"><OracleText text={f.oracleText} /></div>}
                                    {(f.power || f.toughness) && <div className="hover-pt">{f.power}/{f.toughness}</div>}
                                </div>
                            ))}
                        </div>
                    )}
                    {hasKeywords && (
                        <div className="effect-group">
                            <div className="effect-group-label">Keywords</div>
                            {detectedKeywords.map(({ keyword, description }) => (
                                <div key={keyword} className="effect-line keyword-effect">
                                    <span className="keyword-name">{keyword.replace(/\b\w/g, c => c.toUpperCase())}</span>
                                    <span className="keyword-desc">{description}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {hasCounters && (
                        <div className="effect-group">
                            <div className="effect-group-label">Counters</div>
                            {counterEntries.map(([name, val]) => {
                                const eot = !!(card.endOfTurnCounters && card.endOfTurnCounters[name]);
                                return (
                                    <div key={name} className="effect-line counter-effect">
                                        <span className="effect-icon counter-icon">+</span>
                                        <span><strong>{name}</strong> × {val}{eot ? <em className="eot-tag"> (EOT)</em> : null}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {hasNotes && (
                        <div className="effect-group">
                            <div className="effect-group-label">Effects / Notes</div>
                            {card.notes.map((note, i) => {
                                const noteObj = typeof note === 'string' ? { text: note, card: null } : note;
                                return (
                                    <div key={i} className="effect-line note-effect">
                                        {noteObj.card?.imageUri && (
                                            <img src={noteObj.card.imageUri} alt={noteObj.card.name} className="effect-card-thumb" />
                                        )}
                                        <span><OracleText text={noteObj.text} /></span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {attached && attachedToName && (
                        <div className="effect-group">
                            <div className="effect-group-label">Attached to</div>
                            <div className="effect-line attach-effect">
                                <span className="effect-icon">🔗</span>
                                <span><strong>{attachedToName}</strong></span>
                            </div>
                        </div>
                    )}
                    {hasAttachments && (
                        <div className="effect-group">
                            <div className="effect-group-label">Equipped / Enchanted by</div>
                            {attachments.map((att, i) => (
                                <div key={i} className="effect-line attach-effect">
                                    {att.imageUri && (
                                        <img src={att.imageUri.replace('/normal/', '/small/')} alt={att.name} className="effect-card-thumb" />
                                    )}
                                    <span><strong>{att.name}</strong></span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>,
        document.body
    );
}

// Compute a hover position object from a pointer event. Anchors from
// the bottom when the cursor is in the lower half of the viewport so
// tall side panels grow upward. Works for both element-centered
// hovers (pass the target's bounding rect) and free-floating
// pointer-tracked hovers (pass the event directly, omit rect).
export function computeHoverPos(e, { panelWidth = 240, side = 'auto' } = {}) {
    const ZOOM_W = 320;
    const ZOOM_H = 460;
    const totalWidth = ZOOM_W + (panelWidth > 0 ? panelWidth + 8 : 0);
    const spaceRight = window.innerWidth - e.clientX;
    let x;
    if (side === 'right' || (side === 'auto' && spaceRight >= totalWidth + 20)) {
        x = e.clientX + 16;
    } else if (side === 'left' || (side === 'auto' && e.clientX >= totalWidth + 20)) {
        x = e.clientX - totalWidth - 16;
    } else {
        x = spaceRight > e.clientX
            ? Math.min(e.clientX + 16, window.innerWidth - totalWidth - 10)
            : Math.max(10, e.clientX - totalWidth - 16);
    }
    const cardCenterY = e.clientY;
    const preferBottom = cardCenterY > window.innerHeight / 2;
    let y;
    let fromBottom = false;
    if (preferBottom) {
        const desiredBottom = cardCenterY + ZOOM_H / 2;
        y = Math.max(10, window.innerHeight - desiredBottom);
        fromBottom = true;
    } else {
        y = cardCenterY - ZOOM_H / 2;
        y = Math.max(10, Math.min(y, window.innerHeight - ZOOM_H - 10));
    }
    return { x, y, fromBottom };
}
