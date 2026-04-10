import React, { createContext, useCallback, useContext, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

/*
 * Dialog system — replaces window.alert / window.confirm / window.prompt with
 * styled in-app modals.
 *
 * Usage:
 *   const dialog = useDialog();
 *   await dialog.alert('Something happened');
 *   const ok = await dialog.confirm('Delete this deck?');
 *   const value = await dialog.prompt('Counter name:', 'energy');
 *
 * All three return Promises so they can be awaited inline like the browser
 * built-ins. confirm() resolves to true/false; prompt() resolves to the typed
 * string or null if cancelled; alert() resolves to undefined.
 */

const DialogContext = createContext(null);

export function useDialog() {
    const ctx = useContext(DialogContext);
    if (!ctx) throw new Error('useDialog must be used within DialogProvider');
    return ctx;
}

export function DialogProvider({ children }) {
    const [dialogs, setDialogs] = useState([]); // queue of active dialogs
    const idRef = useRef(0);

    const closeDialog = useCallback((id, result) => {
        setDialogs(prev => {
            const target = prev.find(d => d.id === id);
            if (target) target.resolve(result);
            return prev.filter(d => d.id !== id);
        });
    }, []);

    const open = useCallback((opts) => {
        return new Promise((resolve) => {
            const id = ++idRef.current;
            setDialogs(prev => [...prev, { id, ...opts, resolve }]);
        });
    }, []);

    const api = {
        alert: (message, { title = 'Notice' } = {}) =>
            open({ kind: 'alert', title, message }),
        confirm: (message, { title = 'Confirm', danger = false, confirmLabel = 'OK', cancelLabel = 'Cancel' } = {}) =>
            open({ kind: 'confirm', title, message, danger, confirmLabel, cancelLabel }),
        prompt: (message, defaultValue = '', { title = 'Input', placeholder = '', inputType = 'text' } = {}) =>
            open({ kind: 'prompt', title, message, defaultValue, placeholder, inputType }),
    };

    return (
        <DialogContext.Provider value={api}>
            {children}
            {dialogs.map(d => (
                <DialogShell key={d.id} dialog={d} onClose={(result) => closeDialog(d.id, result)} />
            ))}
        </DialogContext.Provider>
    );
}

function DialogShell({ dialog, onClose }) {
    const [value, setValue] = useState(dialog.defaultValue ?? '');
    const inputRef = useRef(null);

    useEffect(() => {
        if (dialog.kind === 'prompt' && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select?.();
        }
    }, [dialog.kind]);

    useEffect(() => {
        const handler = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                if (dialog.kind === 'confirm' || dialog.kind === 'prompt') onClose(dialog.kind === 'confirm' ? false : null);
                else onClose();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [dialog.kind, onClose]);

    const handleConfirm = () => {
        if (dialog.kind === 'prompt') onClose(value);
        else if (dialog.kind === 'confirm') onClose(true);
        else onClose();
    };

    const handleCancel = () => {
        if (dialog.kind === 'prompt') onClose(null);
        else if (dialog.kind === 'confirm') onClose(false);
        else onClose();
    };

    return createPortal(
        <div className="modal-overlay dialog-overlay">
            <div className={`modal dialog-modal ${dialog.danger ? 'danger-dialog' : ''}`}>
                <div className="modal-header">
                    <h3>{dialog.title}</h3>
                    <button className="close-btn" onClick={handleCancel}>x</button>
                </div>
                {dialog.message && (
                    <p className="dialog-message" style={{ whiteSpace: 'pre-line' }}>{dialog.message}</p>
                )}
                {dialog.kind === 'prompt' && (
                    <input
                        ref={inputRef}
                        type={dialog.inputType || 'text'}
                        value={value}
                        placeholder={dialog.placeholder}
                        onChange={e => setValue(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') handleConfirm();
                        }}
                    />
                )}
                <div className="modal-actions dialog-actions">
                    {(dialog.kind === 'confirm' || dialog.kind === 'prompt') && (
                        <button onClick={handleCancel}>{dialog.cancelLabel || 'Cancel'}</button>
                    )}
                    <button
                        onClick={handleConfirm}
                        className={dialog.danger ? 'danger' : 'primary-btn'}
                    >
                        {dialog.confirmLabel || (dialog.kind === 'alert' ? 'OK' : dialog.kind === 'prompt' ? 'OK' : 'Confirm')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
