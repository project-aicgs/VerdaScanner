/** Bump = tiny add to supply (no market-cap gate). */

export const BUMP_MAX_OWNERSHIP_PCT = 0.1;

/**
 * Qualifies as bump copy in the smart wallet log: 0.00%–0.10% of supply (inclusive).
 * No market-cap requirement.
 *
 * @param {{ ownershipPercentage?: number | null }} row
 * @returns {boolean}
 */
export function isKolBumpMessage(row) {
  const pct = row?.ownershipPercentage;
  if (pct == null || !Number.isFinite(pct)) return false;
  if (pct < 0 || pct > BUMP_MAX_OWNERSHIP_PCT + 1e-9) return false;
  return true;
}

/** @deprecated Use {@link isKolBumpMessage}; same behavior. */
export const isKolBumpingBuy = isKolBumpMessage;

/**
 * Same smart-wallet trader on the same mint for streak grouping.
 * If both rows include `kolWallet`, compare addresses only.
 * If either wallet is missing, fall back to matching `kolName`.
 */
export function sameKolWalletAndMint(a, b) {
  const ma = a?.mint;
  const mb = b?.mint;
  if (typeof ma !== "string" || ma.length === 0 || ma !== mb) return false;

  const wa = typeof a?.kolWallet === "string" ? a.kolWallet.trim() : "";
  const wb = typeof b?.kolWallet === "string" ? b.kolWallet.trim() : "";
  const na = typeof a?.kolName === "string" ? a.kolName.trim() : "";
  const nb = typeof b?.kolName === "string" ? b.kolName.trim() : "";

  if (wa.length > 0 && wb.length > 0) return wa === wb;
  if (na.length > 0 && nb.length > 0 && na === nb) return true;
  return false;
}
