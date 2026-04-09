export function v4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

export const PHASES = [
    { id: 'untap', label: 'Untap' },
    { id: 'upkeep', label: 'Upkeep' },
    { id: 'draw', label: 'Draw' },
    { id: 'main1', label: 'Main 1' },
    { id: 'combat_begin', label: 'Begin Combat' },
    { id: 'combat_attackers', label: 'Attackers' },
    { id: 'combat_blockers', label: 'Blockers' },
    { id: 'combat_damage', label: 'Damage' },
    { id: 'combat_end', label: 'End Combat' },
    { id: 'main2', label: 'Main 2' },
    { id: 'end', label: 'End Step' },
    { id: 'cleanup', label: 'Cleanup' },
];
