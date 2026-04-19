import React, { useEffect, useRef } from 'react';

/*
 * Action log side panel — mirrors Chat's visual pattern but shows the server's
 * actionHistory (append-only log of every mutating event). Visible to both
 * players and spectators, including people who joined late, because the full
 * log ships with gameState on every broadcast.
 *
 * Entries come pre-shaped from server as { actionId, playerId, type, data, timestamp }.
 * formatEntry() below turns them into human-readable lines.
 */

function formatEntry(entry, playerNameById) {
    const actorName = playerNameById[entry.playerId] || 'Someone';
    const d = entry.data || {};
    switch (entry.type) {
        case 'startGame':
            return `Game started (${d.firstPlayer || '?'} goes first)`;
        case 'restartGame':
            return `${actorName} restarted the game`;
        case 'initialDraw':
            return `${d.player || '?'} drew opening hand of ${d.count ?? 7}`;
        case 'turnStart':
            return `Turn begins — ${d.player || '?'}`;
        case 'turnEnd':
            return `${d.player || '?'} ended their turn`;
        case 'autoUntap':
            return `Auto-untapped ${d.count ?? 0} ${d.count === 1 ? 'card' : 'cards'} for ${d.player || '?'}`;
        case 'moveCard':
            return `${actorName} moved ${d.cardName || 'a card'} to ${d.toZone || '?'}`;
        case 'tapCard':
            return `${actorName} ${d.tapped ? 'tapped' : 'untapped'} ${d.cardName || 'a card'}`;
        case 'bulkTap':
            return `${actorName} ${d.tapped === false ? 'untapped' : 'tapped'} ${d.count || 0} cards`;
        case 'bulkMove':
            return `${actorName} moved ${d.count || 0} cards to ${d.toZone || '?'}`;
        case 'flipCard':
            return `${actorName} flipped ${d.cardName || 'a card'}`;
        case 'toggleFaceDown':
            return `${actorName} turned ${d.cardName || 'a card'} ${d.faceDown ? 'face-down' : 'face-up'}`;
        case 'shuffleLibrary':
            return `${actorName} shuffled their library`;
        case 'mill':
            return `${actorName} milled ${d.count || 1}`;
        case 'drawCards':
            return `${actorName} drew ${d.count || 1}${d.faceDown ? ' face-down' : ''}`;
        case 'tutor':
            return `${actorName} tutored ${d.cardName || 'a card'} to ${d.toZone || '?'}${d.shuffled ? ' (shuffled)' : ''}`;
        case 'revealCard':
            return `${actorName} revealed ${d.cardName || 'a card'} to ${d.to || '?'}`;
        case 'revealHand':
            return `${d.player || actorName} revealed their hand (${d.handCount ?? '?'}) to ${d.to || '?'}`;
        case 'scry':
            return `${actorName} scried ${d.count || 1}`;
        case 'setLife':
            return `${actorName} set ${d.target || '?'} life to ${d.to}`;
        case 'adjustLife':
            return `${actorName} ${(d.amount || 0) >= 0 ? 'gained' : 'lost'} ${Math.abs(d.amount || 0)} life (${d.target || '?'} → ${d.newLife})`;
        case 'setPlayerCounter':
            return `${actorName} set ${d.counter} on ${d.target || '?'} to ${d.value}`;
        case 'setCardCounter':
            return `${actorName} set ${d.counter} on ${d.cardName} to ${d.value}`;
        case 'setCommanderDamage':
            return `${actorName} set cmdr damage to ${d.to || '?'} → ${d.damage}`;
        case 'setInfect':
            return `${actorName} set infect on ${d.to || '?'} to ${d.amount}`;
        case 'commanderDied':
            return `${d.player || actorName}'s commander died (×${d.deaths})`;
        case 'setDesignation':
            return `${actorName} set ${d.designation}: ${d.value}`;
        case 'createToken':
            return `${actorName} created ${d.name || 'a token'}`;
        case 'createCustomCard':
            return `${actorName} created ${d.name || 'a custom card'}`;
        case 'mulligan':
            return `${actorName} mulled to ${d.handSize} (mull #${d.mulliganNumber})`;
        case 'mulliganPhaseStart':
            return `Mulligan phase started (${d.players || '?'} players)`;
        case 'setMulliganReady':
            return `${d.player || actorName} ${d.ready ? 'is ready' : 'un-readied'}`;
        case 'rollForFirstPlayer':
            return `${d.player || actorName} rolled a ${d.roll} for first player`;
        case 'firstPlayerTiebreak':
            return `Tie at ${d.roll}! ${d.tied || ''} re-roll`;
        case 'firstPlayerRoll':
            return `First player roll — ${d.rolls || ''}. ${d.winner || '?'} goes first (rolled ${d.winningRoll})`;
        case 'batchToLibrary':
            return `${actorName} placed ${d.count || 0} cards on ${d.position || 'top'} of their library`;
        case 'peekLibraryTop':
            return `${actorName} looked at the top ${d.count} of ${d.target || '?'}'s library`;
        case 'peekResolve':
            return `${d.caster || actorName} exiled ${d.exiledCardName || 'a card'} from ${d.target || '?'}'s library`;
        case 'nextTurn':
            return `Turn passed to ${d.turnPlayer || '?'}`;
        case 'undo':
            return `${actorName} undid the last action`;
        case 'untapAll':
            return `${actorName} untapped all`;
        case 'tapAll':
            return `${actorName} tapped all${d.landsOnly ? ' lands' : ''}`;
        case 'setAutoUntap':
            return `${actorName} turned auto-untap ${d.value ? 'ON' : 'OFF'}`;
        case 'kickPlayer':
            return `${actorName} kicked ${d.kicked || '?'}`;
        case 'loadDeck':
            return `${actorName} loaded ${d.deckName || 'a deck'}`;
        case 'rollDice':
            return `${actorName} rolled ${d.count}d${d.sides}: ${(d.results || []).join(', ')}`;
        case 'flipCoin':
            return `${actorName} flipped ${d.count} coin(s): ${(d.results || []).join(', ')}`;
        case 'victory':
            return `🏆 ${d.player || '?'} is the last player standing!`;
        // ─── Big-batch printers ───────────────────────────────────
        case 'addMana':
            return `${actorName} added ${Math.abs(d.amount || 1)}× ${d.color || '?'} to mana pool`;
        case 'clearManaPool':
            return `${actorName} emptied mana pool`;
        case 'tapForMana':
            return `${actorName} tapped ${d.cardName || 'a land'} for ${d.mana || '?'}`;
        case 'setCardField':
            return `${actorName} set ${d.field} on ${d.cardName || 'a card'} → ${d.value}`;
        case 'cloneCard':
            return `${actorName} cloned ${d.cardName || 'a card'}`;
        case 'foretell':
            return `${actorName} foretold a card`;
        case 'castForetold':
            return `${actorName} cast foretold ${d.cardName || 'a card'}`;
        case 'castFromZone':
            return `${actorName} cast ${d.cardName || 'a card'} from ${d.fromZone}${d.exileAfter ? ' (exiles after)' : ''}`;
        case 'proliferate':
            return `${actorName} proliferated (${d.count || 0} counter${d.count === 1 ? '' : 's'} bumped)`;
        case 'queueExtraTurn':
            return `${actorName} queued an extra turn for ${d.player || '?'}`;
        case 'extraTurnPop':
            return `↺ Extra turn — ${d.player || '?'}`;
        case 'stackPush':
            return `${actorName} put ${d.cardName || 'a spell'} on the stack`;
        case 'stackPop':
            return `${actorName} resolved ${d.cardName || 'something'} from the stack`;
        case 'stackClear':
            return `${actorName} cleared the stack`;
        case 'addEmblem':
            return `${actorName} added emblem to ${d.player || '?'}: ${d.name || ''}`;
        case 'updateRoomSettings':
            return `${actorName} updated room settings`;
        case 'concede':
            return `${d.player || actorName} conceded`;
        case 'mulliganBottom':
            return `${d.player || actorName} bottomed ${d.count || 0} card(s)`;
        case 'takeControl':
            return `${actorName} took control of ${d.cardName || 'a card'} from ${d.from || '?'}${d.untilEndOfTurn ? ' (until EOT)' : ''}`;
        case 'setHandSizeEnforce':
            return `${actorName} turned hand-size enforcement ${d.value ? 'ON' : 'OFF'}`;
        case 'setSharedTeamLife':
            return `${actorName} turned shared team life ${d.value ? 'ON' : 'OFF'}`;
        case 'suspendReady':
            return `⌛ ${d.cardName || 'A suspended card'} is ready to cast`;
        case 'browseLibraryFull':
            return `${actorName} looked through ${d.target || '?'}'s library`;
        case 'setBackground':
            return `${actorName} changed their background`;
        default:
            return `${actorName} ${entry.type}`;
    }
}

function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(typeof ts === 'string' ? Date.parse(ts) : ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ActionLog({ history, players, open, onToggle }) {
    const listRef = useRef(null);
    const playerNameById = {};
    for (const p of (players || [])) {
        playerNameById[p.userId] = p.username;
    }

    // Auto-scroll to latest when panel opens or new entries arrive.
    useEffect(() => {
        if (!open) return;
        const el = listRef.current;
        if (!el) return;
        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }, [history, open]);

    // Render the log in reverse — newest at the bottom (chat-style) so the
    // auto-scroll lands on the most recent event.
    const entries = history || [];

    return (
        <>
            <button
                className={`action-log-toggle ${open ? 'open' : ''}`}
                onClick={onToggle}
                title={open ? 'Hide action log' : 'Show action log'}
                type="button"
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M3 12h18M3 18h12" />
                </svg>
            </button>
            <aside className={`action-log-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
                <div className="chat-header">
                    <h3>Action Log</h3>
                    <button className="close-btn" onClick={onToggle} type="button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
                <div className="action-log-messages" ref={listRef}>
                    {entries.length === 0 && <div className="chat-empty">No actions yet.</div>}
                    {entries.map(e => (
                        <div key={e.actionId} className={`action-log-entry type-${e.type}`}>
                            <div className="action-log-time">{formatTime(e.timestamp)}</div>
                            <div className="action-log-text">{formatEntry(e, playerNameById)}</div>
                        </div>
                    ))}
                </div>
            </aside>
        </>
    );
}
