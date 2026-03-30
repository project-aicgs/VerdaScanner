/**
 * Pump.fun bonding → PumpSwap: graduation is roughly when ~85 SOL of buys
 * have moved along the curve (public rule of thumb; exact on-chain math differs).
 * PumpPortal’s `marketCapSol` tracks SOL-notional along that curve until migration.
 */

export const PUMP_BONDING_TARGET_SOL = 85;

/** Above this SOL-notional we poll Gecko pool resolution aggressively (bonding + post-migration). */
export const PUMP_BONDING_AGGRESSIVE_REFRESH_SOL = 60;

/**
 * Stable key for chart bootstrap: remount when the token likely graduation / venue change so pool discovery runs again.
 * @param {number|null|undefined} marketCapSol
 */
export function chartPoolResolutionEpoch(marketCapSol) {
  if (marketCapSol != null && Number.isFinite(marketCapSol)) {
    return marketCapSol >= PUMP_BONDING_TARGET_SOL ? "post-bonding" : "bonding";
  }
  return "unknown";
}

/**
 * Bonding-graduation / PumpSwap window: chart poll should force fresh pool list + MC resync every tick (~10s).
 */
export function inMigrationChartSyncWindow(marketCapSol) {
  return (
    shouldAggressivelyRefreshChartPools(marketCapSol) ||
    chartPoolResolutionEpoch(marketCapSol) === "post-bonding"
  );
}

/**
 * @param {number|null|undefined} marketCapSol — from PumpPortal trades (`marketCapSol`)
 * @returns {number|null} percent 0–100, or null if unknown
 */
export function bondingCurvePercentFromMarketCapSol(marketCapSol) {
  if (marketCapSol == null || !Number.isFinite(marketCapSol) || marketCapSol < 0) {
    return null;
  }
  return Math.min(100, Math.max(0, (marketCapSol / PUMP_BONDING_TARGET_SOL) * 100));
}

/**
 * True when we should hit Gecko often for a fresh pool list + tight OHLCV freshness.
 * Includes late bonding *and* post-graduation SOL readouts (PumpPortal can report >85 or later drop marketCapSol);
 * a high upper bound was incorrectly turning off refresh right when PumpSwap migration mattered most.
 */
export function shouldAggressivelyRefreshChartPools(marketCapSol) {
  if (marketCapSol == null || !Number.isFinite(marketCapSol)) return false;
  return marketCapSol >= PUMP_BONDING_AGGRESSIVE_REFRESH_SOL;
}
