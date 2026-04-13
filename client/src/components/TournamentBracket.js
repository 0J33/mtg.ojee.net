import React from 'react';
import socket from '../socket';

const ROUND_NAMES = ['Round 1', 'Quarterfinals', 'Semifinals', 'Finals'];
function roundName(roundIdx, totalRounds) {
    if (totalRounds <= 1) return 'Finals';
    const fromEnd = totalRounds - 1 - roundIdx;
    if (fromEnd === 0) return 'Finals';
    if (fromEnd === 1) return 'Semifinals';
    if (fromEnd === 2) return 'Quarterfinals';
    return `Round ${roundIdx + 1}`;
}

export default function TournamentBracket({ tournament, isHost, userId, onClose }) {
    if (!tournament) return null;
    const { rounds, champion } = tournament;

    const reportResult = (matchId, winnerId) => {
        socket.emit('tournament:reportResult', { matchId, winnerId });
    };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
            <div className="modal tournament-modal">
                <div className="modal-header">
                    <h2>{champion ? 'Tournament Complete' : 'Tournament Bracket'}</h2>
                    <button className="close-btn" onClick={onClose}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <div className="bracket-container">
                    {rounds.map((round, rIdx) => (
                        <div key={rIdx} className="bracket-round">
                            <div className="bracket-round-title">{roundName(rIdx, rounds.length)}</div>
                            <div className="bracket-matches">
                                {round.map(match => {
                                    const p1 = match.player1;
                                    const p2 = match.player2;
                                    const canReport = match.status === 'active' && !match.winner &&
                                        (isHost || match.player1?.userId === userId || match.player2?.userId === userId);
                                    const isFinals = rIdx === rounds.length - 1;

                                    return (
                                        <div key={match.id} className={`bracket-match ${match.status} ${isFinals ? 'finals' : ''}`}>
                                            <div className={`bracket-player ${match.winner === p1?.userId ? 'winner' : ''} ${match.winner && match.winner !== p1?.userId ? 'loser' : ''}`}>
                                                <span className="bracket-player-name">{p1?.username || 'BYE'}</span>
                                                {canReport && p1 && (
                                                    <button className="bracket-win-btn" onClick={() => reportResult(match.id, p1.userId)} title="Report as winner">W</button>
                                                )}
                                            </div>
                                            <div className="bracket-vs">vs</div>
                                            <div className={`bracket-player ${match.winner === p2?.userId ? 'winner' : ''} ${match.winner && match.winner !== p2?.userId ? 'loser' : ''}`}>
                                                <span className="bracket-player-name">{p2?.username || 'BYE'}</span>
                                                {canReport && p2 && (
                                                    <button className="bracket-win-btn" onClick={() => reportResult(match.id, p2.userId)} title="Report as winner">W</button>
                                                )}
                                            </div>
                                            {match.status === 'done' && match.winner && (
                                                <div className="bracket-result">
                                                    {p1?.userId === match.winner ? p1.username : p2?.username} wins
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {champion && (
                    <div className="bracket-champion">
                        <span className="bracket-trophy">&#127942;</span>
                        <strong>{rounds[rounds.length - 1]?.[0]?.player1?.userId === champion
                            ? rounds[rounds.length - 1][0].player1.username
                            : rounds[rounds.length - 1][0].player2?.username
                        }</strong> wins the tournament!
                    </div>
                )}

                {!champion && isHost && (
                    <div className="bracket-hint muted">
                        Active matches are highlighted. Click W next to a player's name to report them as the winner.
                    </div>
                )}
            </div>
        </div>
    );
}
