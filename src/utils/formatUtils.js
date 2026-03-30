// Function to format large numbers with abbreviations
export function formatMarketCap(value) {
    if (!value || isNaN(value)) return '$0';
    
    const num = Math.abs(value);
    
    if (num >= 1e9) {
      return '$' + (num / 1e9).toFixed(2) + 'B';
    } else if (num >= 1e6) {
      return '$' + (num / 1e6).toFixed(2) + 'M';
    } else if (num >= 1e3) {
      return '$' + (num / 1e3).toFixed(2) + 'K';
    } else {
      return '$' + num.toFixed(2);
    }
  }
  
  // Function to format volume numbers
  export function formatVolume(value) {
    if (!value || isNaN(value)) return '$0';
    
    const num = Math.abs(value);
    
    if (num >= 1e9) {
      return '$' + (num / 1e9).toFixed(2) + 'B';
    } else if (num >= 1e6) {
      return '$' + (num / 1e6).toFixed(2) + 'M';
    } else if (num >= 1e3) {
      return '$' + (num / 1e3).toFixed(2) + 'K';
    } else {
      return '$' + num.toFixed(2);
    }
  }

/** Formats an approximate token USD price (e.g. low-cap meme prices). */
export function formatTokenPrice(usd) {
  if (usd == null || !Number.isFinite(usd) || usd <= 0) return null;
  if (usd >= 1) {
    return (
      "$" +
      usd.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  const s = usd.toFixed(10).replace(/\.?0+$/, "");
  return "$" + (s.endsWith(".") ? s.slice(0, -1) : s);
}

/**
 * Axis / crosshair labels for micro-cap USD (TradingView Lightweight Charts defaults to 2 decimals).
 */
export function formatChartUsdAxis(usd) {
  if (usd == null || !Number.isFinite(usd)) return "";
  const a = Math.abs(usd);
  if (a === 0) return "$0";
  if (a >= 1) {
    return (
      "$" +
      a.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      })
    );
  }
  if (a >= 0.01) {
    const s = a.toFixed(6).replace(/\.?0+$/, "");
    return "$" + (s.endsWith(".") ? s.slice(0, -1) : s);
  }
  if (a >= 1e-6) {
    const s = a.toFixed(10).replace(/\.?0+$/, "");
    return "$" + (s.endsWith(".") ? s.slice(0, -1) : s);
  }
  return "$" + a.toPrecision(4);
}

/** Large supply / float for on-chain totals (BullX, etc.). */
export function formatTokenAmount(value) {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const num = Math.abs(value);
  if (num >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(2) + "K";
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Place `noimage.png` in `public/` for missing/broken token images. */
export const TOKEN_IMAGE_FALLBACK = "/noimage.png";