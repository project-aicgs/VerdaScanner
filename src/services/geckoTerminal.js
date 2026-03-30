/**
 * geckoTerminal.js — chart data from GeckoTerminal public API.
 *
 * RATE-LIMIT STRATEGY
 * -------------------
 * The public GeckoTerminal API allows ~10 req/min per IP.
 * - Chart init: pool list (throttled), then OHLCV probes on top pools **one at a time**
 *   (throttled, stop at first fresh pool) so we do not burn 3× OHLCV when #1 is live.
 * - All public calls use a serial queue + minimum gap (default 6 s → ~10/min).
 *   Override with VITE_GECKO_MIN_GAP_MS (milliseconds). When a 429 is received,
 *   a 65 s global back-off is applied before any new request is allowed through.
 *
 * CoinGecko Pro vs Demo key
 * -------------------------
 * **Secrets:** Use Netlify `COINGECKO_PRO_API_KEY` / `COINGECKO_DEMO_API_KEY` (server-only)
 * plus `VITE_COINGECKO_USE_NETLIFY_PROXY=true` so the browser calls
 * `/.netlify/functions/coingecko-proxy` and keys never ship in the bundle.
 *
 * Local dev: leave `VITE_COINGECKO_USE_NETLIFY_PROXY` unset; Vite proxies inject
 * `COINGECKO_*` from `.env` (no `VITE_` prefix). Optional `VITE_COINGECKO_PRO_API_KEY`
 * still works for non-Netlify static hosts (not recommended — key is exposed).
 *
 * Demo keys do not have access to /onchain — if Pro fails (400/401/403/503)
 * we suspend Pro for the session and fall back to public GeckoTerminal.
 * Public GeckoTerminal: in the browser use same-origin /gecko-terminal-api
 * (Vite dev proxy + Netlify redirect). Direct calls to api.geckoterminal.com
 * can fail CORS when Cloudflare omits Access-Control-Allow-Origin on some responses.
 */

const GECKO_PROXY_PREFIX = "/gecko-terminal-api";
const COINGECKO_PRO_PROXY_PREFIX = "/coingecko-pro-api";
const NETLIFY_COINGECKO_FN = "/.netlify/functions/coingecko-proxy";

function useNetlifyCoingeckoProxy() {
  return import.meta.env.VITE_COINGECKO_USE_NETLIFY_PROXY === "true";
}

/** Client-side Pro key — only for non-Netlify dev/simple setups; avoid in production. */
function coingeckoProKey() {
  if (useNetlifyCoingeckoProxy()) return "";
  return import.meta.env.VITE_COINGECKO_PRO_API_KEY?.trim?.() || "";
}

/**
 * After one 400/401 from the Pro endpoint we disable it for the entire session.
 * This avoids wasting every chart load on a double-request when a Demo key is
 * mistakenly set as VITE_COINGECKO_PRO_API_KEY.
 */
let _proEndpointSuspended = false;

function useCoingeckoPro() {
  if (useNetlifyCoingeckoProxy()) return !_proEndpointSuspended;
  return Boolean(coingeckoProKey()) && !_proEndpointSuspended;
}

function suspendProEndpointForSession(reason) {
  if (_proEndpointSuspended) return;
  _proEndpointSuspended = true;
  chartLog(
    "Pro API endpoint disabled for this session —",
    reason,
    "(likely a Demo key, not a Pro key)"
  );
}

/** Public GeckoTerminal v2 base (no CoinGecko Pro). */
function geckoPublicV2Base() {
  const fromEnv = import.meta.env.VITE_GECKO_API_BASE?.trim?.();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.protocol?.startsWith("http")) {
    return `${window.location.origin}${GECKO_PROXY_PREFIX}/api/v2`;
  }
  return "https://api.geckoterminal.com/api/v2";
}

/**
 * Chart URLs: `/networks/solana/...` path (same for v2 and /api/v3/onchain).
 * When Pro + Netlify proxy, returns same-origin function URL with encoded path.
 */
function buildCoingeckoChartUrl(pathSuffix) {
  let tail = pathSuffix.startsWith("/") ? pathSuffix : `/${pathSuffix}`;
  if (useCoingeckoPro()) {
    const fullOnchain = `/api/v3/onchain${tail}`;
    if (useNetlifyCoingeckoProxy() && typeof window !== "undefined" && window.location?.origin) {
      return `${window.location.origin}${NETLIFY_COINGECKO_FN}?kind=pro&p=${encodeURIComponent(fullOnchain)}`;
    }
    if (typeof window !== "undefined" && window.location?.protocol?.startsWith("http")) {
      const { hostname } = window.location;
      const isLocal =
        hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
      if (isLocal) {
        return `${window.location.origin}${COINGECKO_PRO_PROXY_PREFIX}${fullOnchain}`;
      }
    }
    return `https://pro-api.coingecko.com${fullOnchain}`;
  }
  return `${geckoPublicV2Base()}${tail}`;
}

// ─── Debug logging ────────────────────────────────────────────────────────────

export const CHART_DEBUG = Boolean(import.meta.env?.DEV);

function chartLog(...args) {
  if (CHART_DEBUG) console.log("[VerdaChart]", ...args);
}
function chartFail(...args) {
  console.error("[VerdaChart]", ...args);
}

function shortPath(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return String(url).slice(0, 80);
  }
}

// ─── Cache ─────────────────────────────────────────────────────────────────

/**
 * Token pool lists (bonding curve vs PumpSwap, etc.) — short TTL so migration
 * off pump.fun doesn’t leave us pinned to a dead pool for 20+ minutes.
 */
/** Short TTL: PumpSwap can replace the bonding pool within seconds of migration. */
const POOL_LIST_TTL_MS = 2 * 60 * 1000;
/** 8 min: if no pool is found, don't hammer the API on every re-open. */
const POOL_MISS_TTL_MS = 8 * 60 * 1000;
/** 3 min: slightly longer OHLCV cache reduces polling frequency meaningfully. */
const OHLCV_TTL_MS = 3 * 60 * 1000;

const MAX_POOL_OHLCV_TRIES = 6;

const poolListCache = new Map();
const poolListInFlight = new Map();
const ohlcvCache = new Map();
const ohlcvInFlight = new Map();

function now() {
  return Date.now();
}
function getCached(map, key) {
  const row = map.get(key);
  if (!row) return undefined;
  if (row.expiresAt <= now()) {
    map.delete(key);
    return undefined;
  }
  return row.value;
}
function setCached(map, key, value, ttlMs) {
  map.set(key, { value, expiresAt: now() + ttlMs });
}
async function dedupe(map, key, factory) {
  const existing = map.get(key);
  if (existing) return existing;
  const p = factory().finally(() => map.delete(key));
  map.set(key, p);
  return p;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Global rate limiter for public GeckoTerminal ─────────────────────────────

/**
 * Serial promise queue — each request waits for the previous one to finish
 * PLUS a minimum gap (sustained polling / sequential fallbacks).
 */
const GECKO_MIN_GAP_MS = (() => {
  const raw = Number(import.meta.env?.VITE_GECKO_MIN_GAP_MS);
  // ~10 req/min public cap → 6 s floor; was 4 s and still tripped 429 with pool + OHLCV.
  return Number.isFinite(raw) && raw >= 500 ? raw : 6_000;
})();
let _geckoQueue = Promise.resolve();
let _geckoLastAt = 0;
/**
 * Set to `Date.now() + 65_000` when a 429 is received. Every queued request
 * will wait until this timestamp before firing.
 */
let _geckoBackoffUntil = 0;

function notifyGecko429() {
  const resumeAt = Date.now() + 65_000;
  if (resumeAt > _geckoBackoffUntil) {
    _geckoBackoffUntil = resumeAt;
    chartLog("429 received — backing off public GeckoTerminal for 65 s");
  }
}

/**
 * Wraps a `fetch()` call with the rate limiter.
 * Only requests to the public GeckoTerminal proxy / origin go through this;
 * Pro-API requests are unthrottled (they have much higher limits).
 */
function geckoThrottledFetch(url, init) {
  const ticket = _geckoQueue.then(async () => {
    const n = Date.now();
    const backWait = Math.max(0, _geckoBackoffUntil - n);
    const gapWait = Math.max(0, _geckoLastAt + GECKO_MIN_GAP_MS - Date.now());
    const wait = Math.max(backWait, gapWait);
    if (wait > 0) await sleep(wait);
    _geckoLastAt = Date.now();
    return fetch(url, init);
  });
  // Don't let errors in one request break the queue for subsequent ones.
  _geckoQueue = ticket.catch(() => {});
  return ticket;
}

function isPublicGeckoUrl(url) {
  return (
    typeof url === "string" &&
    (url.includes(GECKO_PROXY_PREFIX) ||
      url.includes("api.geckoterminal.com"))
  );
}

// ─── Pro-API key injection ─────────────────────────────────────────────────

/** Inject Pro key only for CoinGecko Pro (`pro-api.coingecko.com`); never on GeckoTerminal. */
function buildGeckoFetchHeaders(requestUrl) {
  const key = coingeckoProKey();
  const headers = { accept: "application/json" };
  if (!key) return headers;

  const str = typeof requestUrl === "string" ? requestUrl : "";
  if (str.includes(COINGECKO_PRO_PROXY_PREFIX) || str.includes(NETLIFY_COINGECKO_FN)) {
    return headers;
  }
  try {
    const host = new URL(str).hostname;
    if (host === "pro-api.coingecko.com") {
      headers["x-cg-pro-api-key"] = key;
    }
  } catch {
    /* ignore */
  }
  return headers;
}

// ─── Pro → public fallback URL mapping ────────────────────────────────────

function toPublicGeckoTerminalFallbackUrl(failedUrl) {
  if (typeof failedUrl !== "string") return null;
  try {
    let rest = null;
    let search = "";

    if (failedUrl.includes(NETLIFY_COINGECKO_FN)) {
      const u = new URL(failedUrl, "https://placeholder.invalid");
      const enc = u.searchParams.get("p");
      if (!enc) return null;
      const decoded = decodeURIComponent(enc);
      const q = decoded.indexOf("?");
      const pathOnly = q === -1 ? decoded : decoded.slice(0, q);
      search = q === -1 ? "" : decoded.slice(q);
      if (!pathOnly.startsWith("/api/v3/onchain")) return null;
      rest = pathOnly.slice("/api/v3/onchain".length);
    } else {
      const u = new URL(failedUrl);
      search = u.search;
      if (u.hostname === "pro-api.coingecko.com" && u.pathname.startsWith("/api/v3/onchain")) {
        rest = u.pathname.slice("/api/v3/onchain".length);
      } else if (u.pathname.includes(`${COINGECKO_PRO_PROXY_PREFIX}/`)) {
        const marker = "/api/v3/onchain";
        const i = u.pathname.indexOf(marker);
        if (i === -1) return null;
        rest = u.pathname.slice(i + marker.length);
      } else {
        return null;
      }
    }

    if (typeof window !== "undefined" && window.location?.protocol?.startsWith("http")) {
      return `${window.location.origin}${GECKO_PROXY_PREFIX}/api/v2${rest}${search}`;
    }
    return `https://api.geckoterminal.com/api/v2${rest}${search}`;
  } catch {
    return null;
  }
}

// ─── Core fetch with retry ────────────────────────────────────────────────

/**
 * Fetch JSON with retries.
 *
 * Retry budget:
 *  - 5xx: 3 attempts, exponential 1 s → 2 s → 4 s
 *  - 429: 2 extra attempts (3 total). First retry after the global back-off
 *    has been applied (65 s). The rate-limiter queue handles the actual wait;
 *    we just re-enqueue the request via `geckoThrottledFetch`.
 *  - 400/401 on Pro endpoint: immediately suspend Pro for the session and retry
 *    once on the public fallback (no wait needed).
 */
async function geckoFetchJson(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 22_000;
  /** When false, public GeckoTerminal uses immediate `fetch` (avoid unless Pro/unlimited). */
  const throttle = opts.throttle !== false;
  const max429Attempts = 3;
  const max5xxAttempts = 3;
  let lastStatus = 0;
  let requestUrl = url;
  let triedPublicFallback = false;
  let attempts429 = 0;
  let attempts5xx = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const headers = buildGeckoFetchHeaders(requestUrl);
    chartLog("request", shortPath(requestUrl));

    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try {
      const fetchFn =
        isPublicGeckoUrl(requestUrl) && throttle ? geckoThrottledFetch : fetch;
      res = await fetchFn(requestUrl, { headers, signal: ac.signal });
    } catch (e) {
      clearTimeout(tid);
      const aborted = e?.name === "AbortError";
      chartFail(aborted ? "fetch timeout" : "fetch failed", shortPath(requestUrl), e);
      if (aborted && attempts5xx < max5xxAttempts - 1) {
        attempts5xx++;
        await sleep(600 + Math.random() * 400);
        continue;
      }
      throw e;
    }
    clearTimeout(tid);
    lastStatus = res.status;

    if (res.ok) {
      try {
        const json = await res.json();
        chartLog("response ok", shortPath(requestUrl), "status", res.status);
        return json;
      } catch (parseErr) {
        chartFail("JSON parse failed", shortPath(requestUrl), parseErr);
        throw parseErr;
      }
    }

    let errBody = "";
    try {
      errBody = (await res.clone().text()).slice(0, 400);
    } catch { /* ignore */ }

    // ── 400/401 on Pro endpoint: suspend Pro for the session, retry on public ──
    const isProEndpointRequest =
      !triedPublicFallback &&
      (requestUrl.includes(COINGECKO_PRO_PROXY_PREFIX) ||
        requestUrl.includes("pro-api.coingecko.com") ||
        (requestUrl.includes(NETLIFY_COINGECKO_FN) &&
          requestUrl.includes("kind=pro")));
    if (isProEndpointRequest && [400, 401, 403, 503].includes(res.status)) {
      suspendProEndpointForSession(`HTTP ${res.status}`);
      const fallback = toPublicGeckoTerminalFallbackUrl(requestUrl);
      if (fallback) {
        chartFail("Pro API returned", res.status, "— switching to public GeckoTerminal", {
          path: shortPath(requestUrl),
          detail: errBody || undefined,
        });
        triedPublicFallback = true;
        requestUrl = fallback;
        continue; // immediate retry on public (no wait — rate limiter handles pacing)
      }
    }

    // ── 429: trigger global back-off, re-queue ──
    if (res.status === 429) {
      notifyGecko429();
      attempts429++;
      chartFail("HTTP 429", { path: shortPath(requestUrl), attempt: attempts429, maxAttempts: max429Attempts });
      if (attempts429 < max429Attempts) {
        chartLog(`429 retry ${attempts429}/${max429Attempts} — waiting for global back-off`);
        // Throttled fetches wait inside geckoThrottledFetch; unthrottled fetches would
        // retry immediately and burn all 3 attempts on 429 — must sleep here.
        if (!throttle && isPublicGeckoUrl(requestUrl)) {
          const wait429 = Math.max(0, _geckoBackoffUntil - Date.now());
          if (wait429 > 0) await sleep(wait429);
        }
        continue;
      }
      chartFail("giving up after", max429Attempts, "× HTTP 429", shortPath(requestUrl));
      throw new Error(`GeckoTerminal HTTP 429`);
    }

    // ── 5xx: short exponential back-off ──
    if (res.status >= 500) {
      attempts5xx++;
      chartFail("HTTP", res.status, { path: shortPath(requestUrl), attempt: attempts5xx });
      if (attempts5xx < max5xxAttempts) {
        const delay = 1_000 * 2 ** (attempts5xx - 1) + Math.random() * 500;
        chartLog(`5xx retry in ${Math.round(delay)} ms`);
        await sleep(delay);
        continue;
      }
      chartFail("giving up after", max5xxAttempts, "× 5xx", shortPath(requestUrl));
      throw new Error(`GeckoTerminal HTTP ${res.status}`);
    }

    // ── Other non-OK (4xx except 400/401 handled above) ──
    chartFail("HTTP error", res.status, shortPath(requestUrl), errBody || undefined);
    throw new Error(`GeckoTerminal HTTP ${res.status}`);
  }
}

// ─── Pool discovery ───────────────────────────────────────────────────────

const TOKEN_POOLS_SORT = "h24_volume_usd_liquidity_desc";

async function fetchPoolAddressListUncached(mint) {
  chartLog("pool list for mint", mint?.slice?.(0, 8) + "…");
  const qs = new URLSearchParams({ page: "1", sort: TOKEN_POOLS_SORT });
  const url = buildCoingeckoChartUrl(
    `/networks/solana/tokens/${encodeURIComponent(mint)}/pools?${qs}`
  );
  const json = await geckoFetchJson(url);
  const pools = json.data;
  if (!Array.isArray(pools) || pools.length === 0) {
    chartLog("no pools in response");
    return [];
  }
  const out = [];
  for (const row of pools) {
    const addr = row?.attributes?.address;
    if (typeof addr === "string" && addr.length > 0) out.push(addr);
    if (out.length >= 12) break;
  }
  chartLog("pool addresses", out.length, "of", pools.length, "rows");
  return out;
}

async function getPoolAddressList(mint, { forceRefresh = false } = {}) {
  if (forceRefresh) {
    poolListCache.delete(mint);
  } else {
    const hit = getCached(poolListCache, mint);
    if (hit !== undefined) {
      chartLog("pool list cache hit", mint?.slice?.(0, 8) + "…", hit.length ?? 0);
      return hit;
    }
  }
  return dedupe(poolListInFlight, mint, async () => {
    const list = await fetchPoolAddressListUncached(mint);
    setCached(
      poolListCache,
      mint,
      list,
      list.length > 0 ? POOL_LIST_TTL_MS : POOL_MISS_TTL_MS
    );
    return list;
  });
}

/**
 * True if the last candle is too old for `aggregateMinutes` bars (dead bonding
 * pool after PumpSwap migration, empty book, etc.).
 */
/**
 * @param {object} [options]
 * @param {number} [options.maxAgeSec] — override age threshold (e.g. tighter near bonding graduation)
 */
export function ohlcvBarsLookStale(bars, aggregateMinutes = 1, options = {}) {
  if (!bars || !bars.length) return true;
  const lastT = bars[bars.length - 1]?.time;
  if (!Number.isFinite(lastT)) return true;
  const nowMs = Date.now();
  const lastMs = lastT > 1e12 ? lastT : lastT * 1000;
  const ageSec = (nowMs - lastMs) / 1000;
  const override = options.maxAgeSec;
  const threshold =
    override != null && Number.isFinite(override)
      ? override
      : Math.max(210, aggregateMinutes * 120);
  return ageSec > threshold;
}

/**
 * Pick a pool whose minute OHLCV is non-empty and recently updated. Tries the
 * volume-ranked list in order so when #1 is a frozen bonding-curve pool we
 * fall through to PumpSwap (or the next active venue).
 */
export async function resolveBestPoolForOhlcv(mint, options = {}) {
  const aggregate = options.aggregate ?? 1;
  const limit = options.limit ?? 200;
  const forceRefresh = options.forceRefresh === true;
  /** Tighter “last candle age” when re-resolving pools so a dead bonding pool loses to PumpSwap faster. */
  const probeStaleOpts = forceRefresh ? { maxAgeSec: 90 } : {};

  const addresses = await getPoolAddressList(mint, { forceRefresh });
  if (!addresses.length) return null;

  const tries = Math.min(MAX_POOL_OHLCV_TRIES, addresses.length);
  let fallbackPool = null;

  for (let i = 0; i < tries; i++) {
    const pool = addresses[i];
    let bars;
    try {
      bars = await fetchMinuteOhlcvUncached(pool, { aggregate, limit, throttle: true });
    } catch (e) {
      chartLog("OHLCV probe failed pool idx", i, e?.message ?? e);
      continue;
    }
    if (!bars.length) continue;
    if (!fallbackPool) fallbackPool = pool;
    const key = `${pool}|${aggregate}|${limit}`;
    setCached(ohlcvCache, key, bars, OHLCV_TTL_MS);
    if (!ohlcvBarsLookStale(bars, aggregate, probeStaleOpts)) {
      chartLog("using pool idx", i, pool.slice(0, 8) + "…", "fresh OHLCV");
      return pool;
    }
    chartLog("pool idx", i, pool.slice(0, 8) + "…", "stale OHLCV, trying next");
  }

  if (fallbackPool) {
    chartLog("fallback pool (stale or partial OHLCV)", fallbackPool.slice(0, 8) + "…");
    return fallbackPool;
  }

  return addresses[0];
}

/**
 * @param {object} [opts]
 * @param {number} [opts.aggregate]
 * @param {number} [opts.limit]
 * @param {boolean} [opts.forceRefresh] — refresh pool list from API
 */
export async function fetchBestPoolAddress(mint, opts = {}) {
  return resolveBestPoolForOhlcv(mint, {
    aggregate: opts.aggregate ?? 1,
    limit: opts.limit ?? 200,
    forceRefresh: opts.forceRefresh === true,
  });
}

// ─── OHLCV ────────────────────────────────────────────────────────────────

async function fetchMinuteOhlcvUncached(
  poolAddress,
  { aggregate = 5, limit = 200, throttle = true } = {}
) {
  const params = new URLSearchParams({ aggregate: String(aggregate), limit: String(limit) });
  const url = buildCoingeckoChartUrl(
    `/networks/solana/pools/${encodeURIComponent(poolAddress)}/ohlcv/minute?${params}`
  );
  chartLog("ohlcv for pool", poolAddress?.slice?.(0, 8) + "…", { aggregate, limit, throttle });
  const json = await geckoFetchJson(url, { throttle });
  const list = json.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list) || list.length === 0) {
    chartLog("ohlcv empty list");
    return [];
  }
  const candles = list
    .map((row) => {
      if (!Array.isArray(row) || row.length < 5) return null;
      const [t, open, high, low, close] = row;
      if (!Number.isFinite(t) || !Number.isFinite(open) || !Number.isFinite(high) ||
          !Number.isFinite(low) || !Number.isFinite(close)) return null;
      return { time: t, open, high, low, close };
    })
    .filter(Boolean);
  candles.sort((a, b) => a.time - b.time);
  chartLog("ohlcv bars", candles.length);
  return candles;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.forceRefresh] — skip read cache (but still writes after fetch).
 */
export async function fetchMinuteOhlcv(poolAddress, opts = {}) {
  const aggregate = opts.aggregate ?? 5;
  const limit = opts.limit ?? 200;
  const forceRefresh = opts.forceRefresh === true;
  const key = `${poolAddress}|${aggregate}|${limit}`;

  if (!forceRefresh) {
    const hit = getCached(ohlcvCache, key);
    if (hit !== undefined) {
      chartLog("ohlcv cache hit", key.slice(0, 24) + "…", "bars", hit?.length);
      return hit;
    }
  } else {
    // Even with forceRefresh, if a fresh entry was written very recently
    // (within 30 s) skip the network call to prevent poll-driven bursts.
    const row = ohlcvCache.get(key);
    if (row && row.expiresAt > now() + OHLCV_TTL_MS - 30_000) {
      chartLog("ohlcv poll skipped — entry is still very fresh", key.slice(0, 24) + "…");
      return row.value;
    }
  }

  return dedupe(ohlcvInFlight, key, async () => {
    const data = await fetchMinuteOhlcvUncached(poolAddress, { aggregate, limit });
    setCached(ohlcvCache, key, data, OHLCV_TTL_MS);
    return data;
  });
}

export function geckoTokenUrl(mint) {
  return `https://www.geckoterminal.com/solana/tokens/${encodeURIComponent(mint)}`;
}
