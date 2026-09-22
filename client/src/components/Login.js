import React, { useEffect, useState } from 'react';
import { auth, rooms } from '../api';
import Icon from './Icons';
import '../home.css';

const DISCLAIMER = 'Magic: The Gathering, MTG, and all associated names, logos, card images, and symbols are trademarks of Wizards of the Coast LLC. This is an unofficial fan project, not produced, endorsed, or supported by Wizards of the Coast. Card data provided by Scryfall.';

const FORMAT_NAME = {
    commander: 'Commander', brawl: 'Brawl', oathbreaker: 'Oathbreaker', standard: 'Standard', modern: 'Modern',
    legacy: 'Legacy', vintage: 'Vintage', pauper: 'Pauper', freeform: 'Freeform', draft: 'Draft',
};
const STATE_CLASS = { playing: 'is-playing', drafting: 'is-drafting', quiet: 'is-quiet', waiting: '' };
const GHOST_SLIPS = 30;
// Where tonight's real tables land on the wall: round the edges, since the
// middle sits under the sign-in slip.
const LIVE_SPOTS = [0, 4, 5, 9, 1, 3, 10, 14, 15, 19, 2, 20];

// The board behind the sign-in slip: tonight's real tables (format, seats and
// commander art, nobody named), the rest of the wall bare. The grid runs past
// the screen edge so no row is ever left with a lone slip.
function GhostBoard({ open }) {
    const bySpot = new Map((open?.slips || []).map((t, i) => [LIVE_SPOTS[i], t]));
    return (
        <div className="mh-signin-board" aria-hidden="true">
            {Array.from({ length: GHOST_SLIPS }, (_, i) => {
                const t = bySpot.get(i);
                if (!t) return <div key={i} className="mh-slip mh-ghost is-bare"><span className="mh-pin"><Icon name="pin" size={18} /></span></div>;
                const seats = t.seats.slice(0, 6);
                const empty = Math.max(0, Math.min((t.maxPlayers || 4) - t.seats.length, 4 - seats.length));
                return (
                    <div key={i} className={`mh-slip mh-ghost mh-table ${STATE_CLASS[t.state] || ''}`}>
                        <span className="mh-pin"><Icon name="pin" size={18} /></span>
                        <span className="mh-ghost-format">{FORMAT_NAME[t.format] || t.format}</span>
                        <ol className="mh-seats">
                            {seats.map((art, s) => <li key={s} className="mh-seat" style={art ? { backgroundImage: `url(${art})` } : undefined} />)}
                            {Array.from({ length: empty }, (_, s) => <li key={`e${s}`} className="mh-seat is-empty" />)}
                        </ol>
                    </div>
                );
            })}
        </div>
    );
}

export default function Login({ onLogin }) {
    const [mode, setMode] = useState('signin'); // 'signin' | 'register'
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(null);

    useEffect(() => {
        rooms.open().then((d) => d && !d.error && setOpen(d)).catch(() => {});
    }, []);

    const registering = mode === 'register';

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (busy) return;
        setError('');
        setBusy(true);
        try {
            const data = await (registering ? auth.register : auth.login)(username.trim(), password);
            if (data.error) setError(data.error);
            else onLogin(data.user);
        } catch (_) {
            setError("Can't reach the server. Check your connection and try again.");
        }
        setBusy(false);
    };

    const count = open && open.tables > 0
        ? `${open.tables} table${open.tables === 1 ? '' : 's'} open tonight · ${open.players} playing`
        : open ? 'No tables open yet. Sign in and start the first one.' : '';

    return (
        <main className="mh-signin">
            <GhostBoard open={open} />
            <section className="mh-slip mh-signin-slip" aria-labelledby="mh-signin-title">
                <span className="mh-pin"><Icon name="pin" size={20} /></span>
                <img src="/mtg-logo.svg?v=2" alt="" className="mh-signin-logo" />
                <h1 id="mh-signin-title" className="mh-wordmark">mtg.ojee.net</h1>
                <p className={`mh-signin-count ${open?.tables ? 'is-live' : ''}`}>{count}</p>

                <form className="mh-signin-form" onSubmit={handleSubmit}>
                    <label className="mh-field">
                        <span>Username</span>
                        <input
                            className="mh-input"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoComplete="username"
                            autoCapitalize="none"
                            spellCheck="false"
                            maxLength={24}
                            required
                            autoFocus
                        />
                    </label>
                    <label className="mh-field">
                        <span>Password</span>
                        <input
                            className="mh-input"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete={registering ? 'new-password' : 'current-password'}
                            required
                        />
                    </label>
                    {registering && <p className="mh-hint">Usernames are 2 to 24 characters; passwords at least 4.</p>}
                    {error && <p className="mh-error" role="alert">{error}</p>}
                    <button type="submit" className="mh-primary" disabled={busy}>
                        {busy ? (registering ? 'Making your account…' : 'Signing in…') : registering ? 'Make my account' : 'Sign in'}
                    </button>
                </form>

                <p className="mh-signin-shared">One account for mtg.ojee.net and dnd.ojee.net: sign in on either and you're in on both.</p>
                <button type="button" className="mh-link" onClick={() => { setMode(registering ? 'signin' : 'register'); setError(''); }}>
                    {registering ? 'Already have an account? Sign in' : 'New here? Make an account'}
                </button>
            </section>
            <p className="mh-disclaimer">{DISCLAIMER}</p>
        </main>
    );
}
