import React from 'react';

/*
 * Small SVG icon set. Kept in one place so we can reuse consistent stroke
 * weights and sizing across the app. All icons inherit currentColor so they
 * pick up the parent button's text color.
 *
 * Each icon accepts a `size` prop (default 14) — size is used for both width
 * and height (all icons are square on a 24×24 viewBox).
 */

const base = (size) => ({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: 'false',
});

// Pencil — used for rename actions.
export function IconPencil({ size = 14 }) {
    return (
        <svg {...base(size)}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
    );
}

// Share — box with outgoing arrow. Used for deck / custom-card share buttons.
export function IconShare({ size = 14 }) {
    return (
        <svg {...base(size)}>
            <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
    );
}

// Close X — used for close buttons (keeps the existing text "x" option but
// available here for places that want a proper SVG).
export function IconX({ size = 14 }) {
    return (
        <svg {...base(size)}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    );
}

// Vertical ellipsis — used for the touch-mode player-options dropdown.
export function IconDotsVertical({ size = 14 }) {
    return (
        <svg {...base(size)}>
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
        </svg>
    );
}

// Trash — for destructive delete buttons.
export function IconTrash({ size = 14 }) {
    return (
        <svg {...base(size)}>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
    );
}
