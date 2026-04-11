import React, { useState, useEffect } from 'react';
import { customCards } from '../api';
import { useDialog } from './Dialog';
import { useEscapeKey } from '../utils';
import { IconShare } from './Icons';

/*
 * Custom card library management — used from the lobby, so users can create
 * and edit their personal custom-card pool without having to be in a room.
 * Also handles share codes (generate & import).
 */

const EMPTY_FORM = { name: '', imageUrl: '', manaCost: '', typeLine: '', oracleText: '', power: '', toughness: '' };

export default function CustomCardManager({ onClose }) {
    useEscapeKey(onClose);
    const dialog = useDialog();
    const [cards, setCards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null); // null = not editing, 'new' = new card, else card _id
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    const reload = async () => {
        setLoading(true);
        const res = await customCards.list();
        if (res?.cards) setCards(res.cards);
        setLoading(false);
    };
    useEffect(() => { reload(); }, []);

    const startNew = () => {
        setForm(EMPTY_FORM);
        setEditingId('new');
    };
    const startEdit = (card) => {
        setForm({
            name: card.name || '',
            imageUrl: card.imageUrl || '',
            manaCost: card.manaCost || '',
            typeLine: card.typeLine || '',
            oracleText: card.oracleText || '',
            power: card.power || '',
            toughness: card.toughness || '',
        });
        setEditingId(card._id);
    };
    const cancelEdit = () => {
        setEditingId(null);
        setForm(EMPTY_FORM);
    };

    const save = async () => {
        if (!form.name.trim()) { dialog.alert('Name is required.', { title: 'Missing name' }); return; }
        setSaving(true);
        try {
            if (editingId === 'new') {
                const res = await customCards.create(form);
                if (res?.card) setCards(prev => [res.card, ...prev]);
            } else {
                const res = await customCards.update(editingId, form);
                if (res?.card) setCards(prev => prev.map(c => c._id === editingId ? res.card : c));
            }
            setEditingId(null);
            setForm(EMPTY_FORM);
        } finally {
            setSaving(false);
        }
    };

    const remove = async (card) => {
        const ok = await dialog.confirm(`Delete custom card "${card.name}"?`, { title: 'Delete', danger: true, confirmLabel: 'Delete' });
        if (!ok) return;
        await customCards.delete(card._id);
        setCards(prev => prev.filter(c => c._id !== card._id));
    };

    const shareCard = async (card) => {
        try {
            const res = await customCards.share(card._id);
            if (res?.error || !res?.code) { dialog.alert(res?.error || 'Share failed', { title: 'Share failed' }); return; }
            try { await navigator.clipboard?.writeText(res.code); } catch (_) {}
            await dialog.alert(
                `Share code for "${res.cardName}":\n\n${res.code}\n\nCopied to clipboard. Codes last 180 days.`,
                { title: 'Card share' }
            );
        } catch (err) {
            dialog.alert(err.message || 'Share failed', { title: 'Share failed' });
        }
    };

    const importShare = async () => {
        const code = await dialog.prompt(
            'Enter a custom card share code:',
            '',
            { title: 'Import custom card', placeholder: 'e.g. AB3KMQ78' }
        );
        if (!code) return;
        const res = await customCards.importShare(code.trim().toUpperCase());
        if (res?.error) { dialog.alert(res.error, { title: 'Import failed' }); return; }
        if (res?.card) {
            setCards(prev => [res.card, ...prev]);
            dialog.alert(`Imported "${res.card.name}".`, { title: 'Imported' });
        }
    };

    return (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal custom-card-manager-modal">
                <div className="modal-header">
                    <h2>Custom Cards</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>

                {editingId === null ? (
                    <>
                        <div className="ccm-toolbar">
                            <button className="primary-btn small-btn" onClick={startNew}>New Custom Card</button>
                            <button className="small-btn" onClick={importShare}>Import Share</button>
                        </div>
                        {loading ? (
                            <p className="muted">Loading...</p>
                        ) : cards.length === 0 ? (
                            <p className="muted">No custom cards yet. Create one above — it'll be available in any deck you build.</p>
                        ) : (
                            <div className="ccm-list">
                                {cards.map(c => (
                                    <div key={c._id} className="ccm-row">
                                        {c.imageUrl && <img src={c.imageUrl} alt={c.name} className="ccm-thumb" />}
                                        <div className="ccm-info">
                                            <strong>{c.name}</strong>
                                            <div className="muted">{c.typeLine}</div>
                                        </div>
                                        <div className="ccm-actions">
                                            <button className="small-btn" onClick={() => startEdit(c)}>Edit</button>
                                            <button className="icon-btn" onClick={() => shareCard(c)} title="Share card"><IconShare /></button>
                                            <button className="delete-btn" onClick={() => remove(c)}>x</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="ccm-form">
                        <label>
                            Name
                            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Custom card name" />
                        </label>
                        <label>
                            Image URL
                            <input type="text" value={form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://..." />
                        </label>
                        {form.imageUrl && <img src={form.imageUrl} alt="preview" className="ccm-preview" />}
                        <label>
                            Mana cost
                            <input type="text" value={form.manaCost} onChange={e => setForm({ ...form, manaCost: e.target.value })} placeholder="{3}{U}{U}" />
                        </label>
                        <label>
                            Type line
                            <input type="text" value={form.typeLine} onChange={e => setForm({ ...form, typeLine: e.target.value })} placeholder="Creature — Elder Dragon" />
                        </label>
                        <label>
                            Oracle text
                            <textarea value={form.oracleText} onChange={e => setForm({ ...form, oracleText: e.target.value })} placeholder="Rules text..." rows={4} />
                        </label>
                        <div className="ccm-form-row">
                            <label>
                                Power
                                <input type="text" value={form.power} onChange={e => setForm({ ...form, power: e.target.value })} />
                            </label>
                            <label>
                                Toughness
                                <input type="text" value={form.toughness} onChange={e => setForm({ ...form, toughness: e.target.value })} />
                            </label>
                        </div>
                        <div className="modal-actions">
                            <button onClick={cancelEdit}>Cancel</button>
                            <button className="primary-btn" onClick={save} disabled={saving}>
                                {saving ? 'Saving...' : editingId === 'new' ? 'Create' : 'Save'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
