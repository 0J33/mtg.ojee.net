import React, { useState } from 'react';
import { auth } from '../api';

export default function Login({ onLogin }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isRegister, setIsRegister] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        const fn = isRegister ? auth.register : auth.login;
        const data = await fn(username, password);
        if (data.error) return setError(data.error);
        onLogin(data.user);
    };

    return (
        <div className="login-page">
            <div className="login-card">
                <h1>mtg.ojee.net</h1>
                <p className="login-subtitle">Online MTG Tabletop</p>
                <form onSubmit={handleSubmit}>
                    <input
                        type="text"
                        placeholder="Username"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        autoFocus
                    />
                    <input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                    />
                    {error && <div className="error">{error}</div>}
                    <button type="submit">{isRegister ? 'Register' : 'Login'}</button>
                </form>
                <button className="link-btn" onClick={() => { setIsRegister(!isRegister); setError(''); }}>
                    {isRegister ? 'Already have an account? Login' : "Don't have an account? Register"}
                </button>
            </div>
        </div>
    );
}
