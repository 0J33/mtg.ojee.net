import React from 'react';

// Renders a mana cost string like "{2}{W}{W}" as Scryfall mana symbol images
export default function ManaCost({ cost, oracle }) {
    if (!cost) return null;
    const tokens = cost.match(/\{[^}]+\}/g) || [];
    if (tokens.length === 0) return null;
    return (
        <span className={`mana-symbols ${oracle ? 'inline' : ''}`}>
            {tokens.map((tok, i) => {
                const inner = tok.slice(1, -1);
                return <ManaSymbol key={i} symbol={inner} />;
            })}
        </span>
    );
}

export function ManaSymbol({ symbol }) {
    // Scryfall serves SVGs for all mana symbols at https://svgs.scryfall.io/card-symbols/{SYMBOL}.svg
    // The symbol must be uppercase and have slashes removed
    const normalized = symbol.toUpperCase().replace(/\//g, '');
    const url = `https://svgs.scryfall.io/card-symbols/${normalized}.svg`;
    return <img src={url} alt={symbol} className="mana-sym-img" title={symbol} />;
}

// Replace inline mana symbols in oracle text
export function OracleText({ text }) {
    if (!text) return null;
    const parts = text.split(/(\{[^}]+\})/g);
    return (
        <>
            {parts.map((part, i) => {
                if (part.startsWith('{') && part.endsWith('}')) {
                    return <ManaSymbol key={i} symbol={part.slice(1, -1)} />;
                }
                return <React.Fragment key={i}>{part}</React.Fragment>;
            })}
        </>
    );
}
