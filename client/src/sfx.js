/*
 * SFX — tiny in-browser sound engine for mtg.ojee.net.
 *
 * Everything is synthesized with the Web Audio API (no asset downloads)
 * so adding a new sound is just a new envelope of oscillators and
 * noise bursts. Each effect is a short (<300ms), gain-enveloped tone or
 * chord so it reads as "button click", "card flip", "turn start" etc.
 *
 * Why no audio files: the whole point is one tiny JS module that ships
 * with the client and doesn't require Cloudflare cache warmup for each
 * asset or licensing on third-party SFX. The tradeoff is a synthetic
 * sound palette, which reads as "game UI" for our purposes.
 *
 * Prefs (muted, volume) persist in localStorage so they survive
 * refreshes. The engine is lazy: AudioContext is created on the first
 * play() and suspended if muted, which also satisfies Chrome's
 * autoplay policy (the first user gesture unlocks it).
 */

const VOL_KEY = 'mtg_sfx_volume';
const MUTE_KEY = 'mtg_sfx_muted';

let ctx = null;            // AudioContext
let masterGain = null;     // master volume node
let volume = 0.5;          // 0..1
let muted = false;
let lastPlayAt = new Map(); // name -> ts (throttle)
const listeners = new Set();

function loadPrefs() {
    try {
        const v = parseFloat(localStorage.getItem(VOL_KEY));
        if (!isNaN(v) && v >= 0 && v <= 1) volume = v;
        muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch (_) {}
}
function savePrefs() {
    try {
        localStorage.setItem(VOL_KEY, String(volume));
        localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch (_) {}
}
loadPrefs();

function notify() { for (const fn of listeners) { try { fn(); } catch (_) {} } }

function ensureCtx() {
    if (ctx) return ctx;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : volume;
    masterGain.connect(ctx.destination);
    return ctx;
}

function applyVolume() {
    if (!masterGain) return;
    // Short ramp avoids clicks when toggling mute / dragging the slider.
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.linearRampToValueAtTime(muted ? 0 : volume, now + 0.02);
}

export function getVolume() { return volume; }
export function setVolume(v) {
    volume = Math.max(0, Math.min(1, +v || 0));
    applyVolume();
    savePrefs();
    notify();
}
export function isMuted() { return muted; }
export function setMuted(m) {
    muted = !!m;
    applyVolume();
    savePrefs();
    notify();
}
export function toggleMuted() { setMuted(!muted); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Envelope helper: schedules an attack/decay on a gain node.
function env(gainNode, attack, peak, decay, release = 0) {
    if (!ctx) return;
    const now = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(peak, now + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay + release);
}

function tone({ freq, type = 'sine', duration = 0.12, peak = 0.3, slideTo = null, delay = 0, attack = 0.002 }) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    const start = ctx.currentTime + delay;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), start + duration);
    osc.connect(g).connect(masterGain);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.start(start);
    osc.stop(start + duration + 0.02);
}

function noise({ duration = 0.2, peak = 0.25, filterFreq = 2000, filterType = 'bandpass', q = 1, delay = 0 }) {
    if (!ctx) return;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    filter.Q.value = q;
    const g = ctx.createGain();
    src.connect(filter).connect(g).connect(masterGain);
    const start = ctx.currentTime + delay;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.start(start);
    src.stop(start + duration + 0.02);
}

// Sound recipes. Keep each <300ms so rapid events don't stack into a
// droning mess. If a sound fires too often, it's throttled per-name.
const THROTTLE_MS = {
    click: 25,
    tap: 40,
    flip: 60,
    move: 60,
    life_up: 50,
    life_down: 50,
    default: 30,
};

const recipes = {
    click:     () => tone({ freq: 900, type: 'square', duration: 0.05, peak: 0.08, attack: 0.001 }),
    tap:       () => { tone({ freq: 520, type: 'triangle', duration: 0.09, peak: 0.18, slideTo: 420 }); },
    untap:     () => { tone({ freq: 420, type: 'triangle', duration: 0.10, peak: 0.18, slideTo: 560 }); },
    flip:      () => { tone({ freq: 700, type: 'triangle', duration: 0.06, peak: 0.16, slideTo: 420 }); noise({ duration: 0.07, peak: 0.08, filterFreq: 3500, filterType: 'highpass' }); },
    draw:      () => { noise({ duration: 0.12, peak: 0.12, filterFreq: 2500, filterType: 'highpass' }); tone({ freq: 780, type: 'sine', duration: 0.12, peak: 0.1, slideTo: 980, delay: 0.01 }); },
    shuffle:   () => { noise({ duration: 0.28, peak: 0.14, filterFreq: 2800, filterType: 'bandpass', q: 0.8 }); },
    turn:      () => { tone({ freq: 660, type: 'sine', duration: 0.22, peak: 0.2 }); tone({ freq: 990, type: 'sine', duration: 0.28, peak: 0.15, delay: 0.05 }); },
    life_up:   () => { tone({ freq: 660, type: 'sine', duration: 0.14, peak: 0.22, slideTo: 990 }); },
    life_down: () => { tone({ freq: 520, type: 'sine', duration: 0.14, peak: 0.22, slideTo: 330 }); },
    move:      () => { tone({ freq: 220, type: 'sine', duration: 0.10, peak: 0.25, slideTo: 160 }); noise({ duration: 0.06, peak: 0.05, filterFreq: 500, filterType: 'lowpass' }); },
    counter:   () => tone({ freq: 1200, type: 'square', duration: 0.04, peak: 0.08, attack: 0.001 }),
    pile:      () => { noise({ duration: 0.12, peak: 0.1, filterFreq: 1500, filterType: 'bandpass', q: 1.2 }); },
    token:     () => { tone({ freq: 440, type: 'triangle', duration: 0.12, peak: 0.16 }); tone({ freq: 660, type: 'triangle', duration: 0.14, peak: 0.1, delay: 0.04 }); },
    error:     () => { tone({ freq: 220, type: 'sawtooth', duration: 0.15, peak: 0.18 }); tone({ freq: 180, type: 'sawtooth', duration: 0.18, peak: 0.12, delay: 0.02 }); },
    chat:      () => tone({ freq: 1100, type: 'sine', duration: 0.12, peak: 0.18, slideTo: 1400 }),
    reveal:    () => { tone({ freq: 880, type: 'sine', duration: 0.20, peak: 0.2 }); tone({ freq: 1320, type: 'sine', duration: 0.24, peak: 0.15, delay: 0.08 }); },
    win:       () => { tone({ freq: 523, type: 'triangle', duration: 0.25, peak: 0.22 }); tone({ freq: 659, type: 'triangle', duration: 0.3, peak: 0.2, delay: 0.08 }); tone({ freq: 784, type: 'triangle', duration: 0.4, peak: 0.2, delay: 0.16 }); },
    notify:    () => { tone({ freq: 988, type: 'sine', duration: 0.14, peak: 0.2 }); tone({ freq: 1318, type: 'sine', duration: 0.18, peak: 0.14, delay: 0.06 }); },
};

export function play(name) {
    if (muted || volume <= 0) return;
    const recipe = recipes[name];
    if (!recipe) return;
    // Throttle: prevent a flood (e.g. five card moves in one batch) from
    // sounding like a buzzsaw.
    const now = performance.now();
    const gap = THROTTLE_MS[name] ?? THROTTLE_MS.default;
    const last = lastPlayAt.get(name) || 0;
    if (now - last < gap) return;
    lastPlayAt.set(name, now);
    // Lazy-init the context on first user gesture (satisfies autoplay policy).
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    try { recipe(); } catch (_) {}
}

// Install a delegated listener on document so every <button> click plays
// the 'click' sound without each component having to opt in. Buttons that
// already map to an action-specific sound (e.g. "Flip" → flip, "Shuffle"
// → shuffle) can opt out with data-sfx="none" or supply their own via
// data-sfx="tap".
function onGlobalClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.disabled) return;
    const override = btn.getAttribute('data-sfx');
    if (override === 'none') return;
    play(override || 'click');
}
if (typeof document !== 'undefined') {
    document.addEventListener('click', onGlobalClick, { capture: true });
}
