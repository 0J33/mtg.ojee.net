const API = process.env.REACT_APP_SERVER_URL || 'http://localhost:5002';

async function request(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    return res.json();
}

export const auth = {
    me: () => request('/api/auth/me'),
    register: (username, password) => request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
    login: (username, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    logout: () => request('/api/auth/logout', { method: 'POST' }),
};

export const decks = {
    list: () => request('/api/decks'),
    get: (id) => request(`/api/decks/${id}`),
    create: (deck) => request('/api/decks', { method: 'POST', body: JSON.stringify(deck) }),
    update: (id, deck) => request(`/api/decks/${id}`, { method: 'PUT', body: JSON.stringify(deck) }),
    delete: (id) => request(`/api/decks/${id}`, { method: 'DELETE' }),
};

export const imports = {
    text: (text) => request('/api/import/text', { method: 'POST', body: JSON.stringify({ text }) }),
    moxfield: (url) => request('/api/import/moxfield', { method: 'POST', body: JSON.stringify({ url }) }),
};

export const scryfall = {
    search: (q, opts = {}) => request(`/api/scryfall/search?q=${encodeURIComponent(q)}${opts.include_extras ? '&include_extras=true' : ''}`),
    named: (name, fuzzy = false) => request(`/api/scryfall/named?${fuzzy ? 'fuzzy' : 'exact'}=${encodeURIComponent(name)}`),
};
