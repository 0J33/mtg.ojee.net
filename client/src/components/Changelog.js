import React from 'react';
import { createPortal } from 'react-dom';
import { CHANGELOG } from '../changelog';
import { useEscapeKey } from '../utils';

export default function Changelog({ onClose }) {
    useEscapeKey(onClose);

    return createPortal(
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal changelog-modal">
                <div className="modal-header">
                    <h2>Changelog</h2>
                    <button className="close-btn" onClick={onClose} type="button">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <div className="changelog-body">
                    {CHANGELOG.map((entry, i) => (
                        <div key={i} className="changelog-entry">
                            <div className="changelog-version-row">
                                <span className="changelog-version">v{entry.version}</span>
                                <span className="changelog-date">{entry.date}</span>
                            </div>
                            <ul className="changelog-list">
                                {entry.changes.map((c, j) => (
                                    <li key={j}>{c}</li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>
        </div>,
        document.body
    );
}
