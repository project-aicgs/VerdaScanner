// Central leaderboard store - single source of truth for all tokens
// import { validateTokenData } from './marketCapValidator.js'; // Temporarily disabled
import { tokenContentAllowed } from "./contentFilter.js";

// Single Map to store all tokens
const centralLeaderboard = new Map();
const MAX_LEADERBOARD_GAIN_PERCENT_INCLUSIVE_CAP = 1_000_000;
const MAX_LEADERBOARD_PEAK_MARKET_CAP_USD = 50_000_000;

// Helper function to fix IPFS URLs
function fixIpfsUrl(url) {
  if (!url || !url.includes('ipfs/')) return url;
  const ipfsHash = url.split('ipfs/')[1];
  return `https://ipfs.io/ipfs/${ipfsHash}`;
}

// Standardize token data format regardless of source
function standardizeToken(rawToken, source) {
  const standardized = {
    contractAddress: rawToken.contractAddress || rawToken.mint,
    symbol: rawToken.symbol || "???",
    name: rawToken.name || "Unnamed",
    image: fixIpfsUrl(rawToken.image || rawToken.logo) || "",
    source: source,
    calledAt: rawToken.calledAt || new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    kols: rawToken.kols || []
  };

  // Handle market cap values based on source
  if (source === 'bullx') {
    standardized.initialMarketCap = rawToken.initialMarketCap || 0;
    standardized.peakMarketCap = rawToken.peakMarketCap || rawToken.initialMarketCap || 0;
    standardized.currentMarketCap = rawToken.currentMarketCap || rawToken.peakMarketCap || 0;
  } else if (source === 'pumpfun') {
    // For PumpFun, use marketCapUSD as the current value
    const currentMC = rawToken.marketCapUSD || 0;
    standardized.initialMarketCap = rawToken.initialMarketCap || currentMC;
    standardized.peakMarketCap = rawToken.peakMarketCap || currentMC;
    standardized.currentMarketCap = currentMC;
  }

  return standardized;
}

// Simple validation function to replace the complex one
function simpleValidateToken(rawToken, source) {
  const contractAddress = rawToken.contractAddress || rawToken.mint;
  if (!contractAddress) {
    return { isValid: false, errors: ['No contract address'] };
  }
  
  // Basic market cap validation
  const marketCap = rawToken.marketCapUSD || rawToken.currentMarketCap || rawToken.initialMarketCap || 0;
  if (marketCap < 0 || marketCap > 100_000_000_000) { // Max 100B to filter out obvious errors
    return { isValid: false, errors: [`Invalid market cap: ${marketCap}`] };
  }

  const sym = rawToken.symbol ?? rawToken.ticker;
  const nm = rawToken.name;
  if (!tokenContentAllowed(sym, nm)) {
    return { isValid: false, errors: ["Symbol or name blocked by content filter"] };
  }

  return { isValid: true, data: rawToken };
}

function calculateGainPercent(token) {
  const initial = token?.initialMarketCap;
  const peak = token?.peakMarketCap;
  if (!Number.isFinite(initial) || initial <= 0) return 0;
  if (!Number.isFinite(peak)) return Number.POSITIVE_INFINITY;
  return ((peak - initial) / initial) * 100;
}

/** Global leaderboard exclusion rules: hidden from rows and all leaderboard metrics. */
function isLeaderboardEligible(token) {
  const peak = token?.peakMarketCap;
  if (!Number.isFinite(peak) || peak <= 0) return false;
  if (peak > MAX_LEADERBOARD_PEAK_MARKET_CAP_USD) return false;
  const gain = calculateGainPercent(token);
  if (!Number.isFinite(gain)) return false;
  return gain < MAX_LEADERBOARD_GAIN_PERCENT_INCLUSIVE_CAP;
}

// Add or update a token in the leaderboard WITH SIMPLIFIED VALIDATION
export function addToken(rawToken, source) {
  // console.log(`🔧 [DEBUG] addToken called with:`, {
  //   contractAddress: rawToken.contractAddress || rawToken.mint,
  //   symbol: rawToken.symbol,
  //   source: source,
  //   marketCapUSD: rawToken.marketCapUSD
  // });

  if (!rawToken) {
    // console.warn('addToken: No token data provided');
    return;
  }

  const contractAddress = rawToken.contractAddress || rawToken.mint;
  if (!contractAddress) {
    // console.warn('addToken: No contract address found', rawToken);
    return;
  }

  // SIMPLIFIED VALIDATION
  const validationResult = simpleValidateToken(rawToken, source);
  if (!validationResult.isValid) {
    // console.warn(`❌ Token validation failed for ${rawToken.symbol}:`, validationResult.errors);
    return;
  }

  // Use validated data
  const validatedToken = validationResult.data;

  // console.log(`📝 Adding token to leaderboard:`, {
  //   address: contractAddress,
  //   symbol: validatedToken.symbol,
  //   source: source,
  //   hasExisting: centralLeaderboard.has(contractAddress),
  //   marketCap: validatedToken.marketCapUSD || validatedToken.currentMarketCap
  // });

  const existing = centralLeaderboard.get(contractAddress);
  
  if (existing) {
    // console.log(`🔄 Updating existing token: ${existing.symbol}`);
    // Update existing token
    const newMarketCap = source === 'bullx' ? 
      (validatedToken.peakMarketCap || validatedToken.currentMarketCap || 0) :
      (validatedToken.marketCapUSD || 0);
    
    // Update peak if new value is higher
    if (newMarketCap > existing.peakMarketCap) {
      existing.peakMarketCap = newMarketCap;
      // console.log(`📈 New peak MC for ${existing.symbol}: ${newMarketCap}`);
    }
    
    existing.currentMarketCap = newMarketCap;
    existing.lastUpdated = new Date().toISOString();
    
    // Merge KOLs if new ones provided
    if (validatedToken.kols && validatedToken.kols.length > 0) {
      validatedToken.kols.forEach(kol => {
        if (!existing.kols.includes(kol)) {
          existing.kols.push(kol);
        }
      });
    }
    
  } else {
    // Add new token
    const standardized = standardizeToken(validatedToken, source);
    centralLeaderboard.set(contractAddress, standardized);
    // console.log(`✅ Successfully added ${standardized.symbol} to leaderboard. Total tokens: ${centralLeaderboard.size}`);
  }
}

// Update market cap for existing token WITH SIMPLIFIED VALIDATION
export function updateMarketCap(contractAddress, newMarketCap, volumeUSD = 0) {
  // console.log(`🔧 [DEBUG] updateMarketCap called:`, {
  //   contractAddress,
  //   newMarketCap,
  //   volumeUSD,
  //   hasToken: centralLeaderboard.has(contractAddress)
  // });

  const existing = centralLeaderboard.get(contractAddress);
  if (!existing) {
    // console.warn(`updateMarketCap: Token not found: ${contractAddress}`);
    return;
  }

  // Simple validation - just check if it's a reasonable number
  if (isNaN(newMarketCap) || newMarketCap < 0 || newMarketCap > 100_000_000_000) {
    // console.warn(`❌ Invalid market cap update: ${newMarketCap}`);
    return;
  }

  // Update peak if new value is higher
  if (newMarketCap > existing.peakMarketCap) {
    existing.peakMarketCap = newMarketCap;
    // console.log(`📈 New peak MC for ${existing.symbol}: $${newMarketCap.toLocaleString()}`);
  }
  
  existing.currentMarketCap = newMarketCap;
  existing.lastUpdated = new Date().toISOString();
  // console.log(`💹 Updated ${existing.symbol} MC: $${newMarketCap.toLocaleString()}`);
}

// Get all tokens for leaderboard display
export function getAllTokens() {
  const tokens = Array.from(centralLeaderboard.values()).filter(isLeaderboardEligible);
  // console.log(`📊 [DEBUG] getAllTokens returning ${tokens.length} tokens`);
  return tokens;
}

// Get single token data
export function getToken(contractAddress) {
  return centralLeaderboard.get(contractAddress) || null;
}

// Get leaderboard stats
export function getStats() {
  const tokens = Array.from(centralLeaderboard.values()).filter(isLeaderboardEligible);
  
  const stats = {
    totalTokens: tokens.length,
    bullXCount: tokens.filter(t => t.source === 'bullx').length,
    pumpFunCount: tokens.filter(t => t.source === 'pumpfun').length,
    topPeakMC: tokens.length > 0 ? Math.max(...tokens.map(t => t.peakMarketCap)) : 0,
    avgPeakMC: tokens.length > 0 ? tokens.reduce((sum, t) => sum + t.peakMarketCap, 0) / tokens.length : 0
  };
  
  // console.log(`📊 [DEBUG] getStats returning:`, stats);
  return stats;
}

// Debug function to check store state
export function debugStore() {
  // const stats = getStats();
  // Check for duplicates by symbol
  const symbolCount = {};
  centralLeaderboard.forEach((token, address) => {
    if (symbolCount[token.symbol]) {
      symbolCount[token.symbol].push(address);
    } else {
      symbolCount[token.symbol] = [address];
    }
  });
  
  const duplicates = Object.entries(symbolCount).filter(([symbol, addresses]) => addresses.length > 1);
  if (duplicates.length > 0) {
    // console.log('⚠️ Duplicate symbols:', duplicates);
  } else {
    // console.log('✅ No duplicate symbols found');
  }
  
}

// Clear all data (for testing)
export function clearStore() {
  centralLeaderboard.clear();
  // console.log('🗑️ Leaderboard store cleared');
}

// Export for use in validator
export { centralLeaderboard };