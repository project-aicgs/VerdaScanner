/**
 * Pump.fun bonding → PumpSwap: graduation is roughly when ~85 SOL of buys
 * have moved along the curve (public rule of thumb; exact on-chain math differs).
 * PumpPortal’s `marketCapSol` tracks SOL-notional along that curve until migration.
 */

export const PUMP_BONDING_TARGET_SOL = 85;

/** Above this SOL-notional we poll Gecko pool resolution aggressively (fast migration). */
export const PUMP_BONDING_AGGRESSIVE_REFRESH_SOL = 60;

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

/** True while still on-curve and close enough to graduation that pool migration is imminent. */
export function shouldAggressivelyRefreshChartPools(marketCapSol) {
  if (marketCapSol == null || !Number.isFinite(marketCapSol)) return false;
  return (
    marketCapSol >= PUMP_BONDING_AGGRESSIVE_REFRESH_SOL &&
    marketCapSol < PUMP_BONDING_TARGET_SOL + 12
  );
}
