/** In-memory feed of large trades per mint for the token modal (≥ $500). */

const MIN_USD = 500;
const MAX_EVENTS = 40;
/** @type {Map<string, Array<{ id: string, side: 'buy'|'sell', usd: number, ts: number, source?: string }>>} */
const byMint = new Map();
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

/**
 * @param {string} mint
 * @param {{ side: 'buy'|'sell', volumeUSD: number, source?: string }} payload
 */
export function recordWhaleActivity(mint, { side, volumeUSD, source }) {
  if (!mint || volumeUSD == null || !Number.isFinite(volumeUSD) || volumeUSD < MIN_USD) {
    return;
  }
  const s = side === "sell" ? "sell" : "buy";
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const row = {
    id,
    side: s,
    usd: volumeUSD,
    ts: Date.now(),
    source,
  };
  const arr = byMint.get(mint) || [];
  arr.unshift(row);
  if (arr.length > MAX_EVENTS) arr.length = MAX_EVENTS;
  byMint.set(mint, arr);
  notify();
}

export function getWhaleEvents(mint) {
  if (!mint) return [];
  return byMint.get(mint) ? [...byMint.get(mint)] : [];
}

export function subscribeWhaleActivity(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
