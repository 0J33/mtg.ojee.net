/*
 * Moxfield API client with strict rate limiting.
 *
 * Moxfield granted us private API access under explicit terms:
 *   1. No support — undocumented / unsupported
 *   2. No profit from the data
 *   3. Strict 1 request per second limit — exceeding it gets our IP
 *      banned and the user-agent revoked
 *   4. The user-agent string is secret and must not be shared or committed
 *
 * This module is the ONE choke point for every outgoing Moxfield request,
 * so it's the only place that needs to enforce #3 and #4. Everything else
 * in the app goes through `fetchMoxfield()` and inherits the guarantees.
 *
 * Key properties:
 *   - All requests are serialized through a single promise chain — no two
 *     fetches are ever in-flight concurrently, even if multiple users hit
 *     "Import from Moxfield" at the exact same moment.
 *   - A minimum interval between requests is enforced (default 1500ms, which
 *     is 50% safety margin over Moxfield's 1/sec limit). Configurable via
 *     MOXFIELD_MIN_INTERVAL_MS env var.
 *   - In-memory response cache keyed by deck id, TTL configurable via
 *     MOXFIELD_CACHE_TTL_MS (default 1h). Re-importing the same deck URL
 *     within the TTL hits the cache and doesn't call Moxfield at all.
 *   - The user-agent NEVER appears in logs, responses, or error messages.
 *     Errors from fetch are re-thrown with a sanitized message so nothing
 *     leaks upward. If the UA env var is missing, the client returns a
 *     clean "not configured" error instead of silently 500'ing.
 *   - If Moxfield returns 429 (rate limited) or 403 (banned), we increase
 *     the delay for subsequent requests and surface the problem to the
 *     operator via console.warn (without the UA).
 */

const { performance } = require('perf_hooks');

// Floor of 10 seconds. Moxfield's stated limit is 1 req/sec, but we're
// intentionally 10x slower to stay well clear of any accidental burst and
// to be an unambiguously good citizen. Configurable via env var upward
// only — values below 10000ms are clamped back up.
const MIN_INTERVAL_MS = Math.max(
    10_000,
    parseInt(process.env.MOXFIELD_MIN_INTERVAL_MS, 10) || 10_000,
);
// Hard floor — 5x Moxfield's stated 1-req-per-sec limit. The sanity check
// below throws if any logic bug ever lets us through faster than this, even
// if MIN_INTERVAL_MS got somehow misconfigured. This is the "no matter what"
// backstop. Sits comfortably below the 10s soft floor so it never trips
// during normal operation, but is high enough that any future regression
// where requests start firing too quickly will surface immediately.
const HARD_FLOOR_MS = 5000;
const CACHE_TTL_MS = Math.max(
    60_000,
    parseInt(process.env.MOXFIELD_CACHE_TTL_MS, 10) || (60 * 60 * 1000),
);
const CACHE_MAX_ENTRIES = 500;

// The request queue — every fetch chains off this promise, guaranteeing
// serial execution. We use a promise chain instead of an array because it
// handles async-in-async cleanly and doesn't require locking.
//
// IMPORTANT: This rate limiter is per-process. If pm2 is ever switched from
// `fork` to `cluster` mode, each worker would have its own queue and the
// 1-req-per-second contract would silently break. Stay in fork mode, or add
// a file-based / Redis-based mutex before switching.
let queueTail = Promise.resolve();

// Use a monotonic clock for rate-limiting math so a wall-clock jump (NTP
// adjustment, manual clock change, DST) can't accidentally let two requests
// fire closer together than the interval. Date.now() is still used for cache
// TTLs because those need wall-clock semantics.
function monoMs() {
    return performance.now();
}

// Initialize to the current monotonic time so the very first request after a
// process restart still waits the full interval. If we left it at 0, a server
// crash + restart within milliseconds of a previous request could let the
// next one fire immediately and break the 1-req-per-second contract.
let lastRequestStartedAtMono = monoMs();

// Dynamic backoff multiplier. Starts at 1, doubles on 429/403 responses,
// resets on a successful call. Caps at 8x to prevent runaway.
let backoffMultiplier = 1;
const MAX_BACKOFF = 8;

// deckId → { data, expiresAt }
const cache = new Map();

// Redact the UA from any error/log string. Takes a value that might contain
// the UA and returns it with the UA replaced by a placeholder. Called on every
// string that might leave this module.
function redact(str) {
    if (typeof str !== 'string') return str;
    const ua = process.env.MOXFIELD_USER_AGENT;
    if (!ua) return str;
    // Global replace, case-insensitive. Using split/join instead of regex
    // to avoid regex-escape headaches on arbitrary UA strings.
    return str.split(ua).join('<REDACTED-UA>');
}

function sanitizeError(err) {
    const msg = redact(err?.message || String(err));
    const e = new Error(msg);
    e.status = err?.status;
    return e;
}

function getFromCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}

function putInCache(key, data) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
        // Evict the oldest entry (insertion order is preserved by Map).
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
    }
    cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Schedule a Moxfield fetch. Returns the parsed JSON response (or throws a
 * sanitized error). Requests are queued and rate-limited globally.
 *
 * @param {string} url — the full Moxfield API URL to fetch
 * @param {object} [opts]
 * @param {string} [opts.cacheKey] — if set, response is cached/looked up under this key
 * @returns {Promise<object>} parsed JSON body
 */
async function fetchMoxfield(url, opts = {}) {
    if (!process.env.MOXFIELD_USER_AGENT) {
        const e = new Error('Moxfield API is not configured on this server');
        e.status = 503;
        throw e;
    }

    // Cache hit (if a key was provided) — return immediately, don't queue.
    if (opts.cacheKey) {
        const hit = getFromCache(opts.cacheKey);
        if (hit) return hit;
    }

    // Chain onto the queue tail. Each task:
    //   1. Waits for the rate-limit window to open (10s by default)
    //   2. Verifies the hard 1000ms floor as a defense-in-depth check
    //   3. Performs the actual fetch
    //   4. Updates lastRequestStartedAtMono on the way out
    const task = queueTail.then(async () => {
        const interval = MIN_INTERVAL_MS * backoffMultiplier;
        const wait = lastRequestStartedAtMono + interval - monoMs();
        if (wait > 0) {
            await new Promise(r => setTimeout(r, wait));
        }

        // Hard sanity check. The wait above SHOULD guarantee we never fire
        // within HARD_FLOOR_MS of the previous request, but if any code path
        // ever lets us through faster than that — clock weirdness, bug in
        // wait math, future refactor — throw before the fetch happens. This
        // is the "no matter what" backstop the user explicitly asked for.
        const beforeFetchMono = monoMs();
        const elapsedSincePrev = beforeFetchMono - lastRequestStartedAtMono;
        if (elapsedSincePrev < HARD_FLOOR_MS) {
            throw sanitizeError(new Error(
                `Moxfield rate limiter safety check failed: ${Math.round(elapsedSincePrev)}ms since previous request, need >=${HARD_FLOOR_MS}ms`,
            ));
        }
        lastRequestStartedAtMono = beforeFetchMono;

        let response;
        try {
            response = await fetch(url, {
                headers: {
                    'User-Agent': process.env.MOXFIELD_USER_AGENT,
                    'Accept': 'application/json',
                },
            });
        } catch (err) {
            throw sanitizeError(err);
        }

        // Check rate-limit / ban signals
        if (response.status === 429 || response.status === 403) {
            backoffMultiplier = Math.min(MAX_BACKOFF, backoffMultiplier * 2);
            console.warn(`[moxfield] rate-limited or blocked (status=${response.status}), backoff now ${backoffMultiplier}x`);
            const e = new Error(`Moxfield temporarily unavailable (status ${response.status})`);
            e.status = 503;
            throw e;
        }

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            // Don't surface raw response bodies — they might contain whatever
            // Moxfield decided to echo back. Log them for debugging and return
            // a generic error.
            console.warn(`[moxfield] non-ok response status=${response.status} bodyPrefix=${redact(text.slice(0, 200))}`);
            const e = new Error(`Moxfield returned ${response.status}`);
            e.status = response.status;
            throw e;
        }

        // Success — reset backoff
        if (backoffMultiplier !== 1) {
            console.log('[moxfield] recovered, backoff reset');
            backoffMultiplier = 1;
        }

        let data;
        try {
            data = await response.json();
        } catch (err) {
            throw sanitizeError(new Error('Moxfield returned non-JSON response'));
        }

        if (opts.cacheKey) putInCache(opts.cacheKey, data);
        return data;
    });

    // Ensure the queue can't get stuck on a rejected promise — swallow
    // errors on the chain reference while still propagating them to callers.
    queueTail = task.catch(() => {});
    return task;
}

/**
 * Convenience: fetch a Moxfield deck by id. Uses the v3 endpoint by default,
 * falls back to v2 if v3 fails. The deck id should be extracted from the URL
 * before calling (e.g. moxfield.com/decks/nN3SBcHQfkGb-sj8QxYDaQ → the hash).
 */
async function fetchMoxfieldDeck(deckId) {
    if (!deckId || typeof deckId !== 'string') {
        const e = new Error('Deck id required');
        e.status = 400;
        throw e;
    }
    // Try v3 first (newer schema). If it 404s, fall back to v2. Both go
    // through the same rate limiter.
    try {
        return await fetchMoxfield(
            `https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(deckId)}`,
            { cacheKey: `v3:${deckId}` },
        );
    } catch (err) {
        if (err?.status === 404 || err?.status === 400) {
            return await fetchMoxfield(
                `https://api.moxfield.com/v2/decks/all/${encodeURIComponent(deckId)}`,
                { cacheKey: `v2:${deckId}` },
            );
        }
        throw err;
    }
}

// Diagnostics for debugging / admin tooling. Returns counts + the current
// backoff state but NEVER the UA or cached response bodies.
function stats() {
    return {
        configured: !!process.env.MOXFIELD_USER_AGENT,
        minIntervalMs: MIN_INTERVAL_MS,
        hardFloorMs: HARD_FLOOR_MS,
        cacheTtlMs: CACHE_TTL_MS,
        cacheSize: cache.size,
        backoffMultiplier,
        msSinceLastRequest: Math.round(monoMs() - lastRequestStartedAtMono),
    };
}

module.exports = { fetchMoxfield, fetchMoxfieldDeck, stats };
