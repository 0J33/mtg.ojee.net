import React from 'react';
import Icon from './Icons';
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
                        <Icon name="close" size={16} />
                    </button>
                </div>

                <div className="changelog-body">
                    {CHANGELOG.map((entry, i) => (
                        <div key={i} className="changelog-entry">
                            <div className="changelog-version-row">
                                <span className="changelog-version">{/^\d/.test(entry.version) ? `v${entry.version}` : entry.version}</span>
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
