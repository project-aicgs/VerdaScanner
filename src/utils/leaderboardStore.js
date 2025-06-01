// Central leaderboard store - single source of truth for all tokens

// Single Map to store all tokens
const centralLeaderboard = new Map();

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

// Add or update a token in the leaderboard
export function addToken(rawToken, source) {
  if (!rawToken) {
    console.warn('addToken: No token data provided');
    return;
  }

  const contractAddress = rawToken.contractAddress || rawToken.mint;
  if (!contractAddress) {
    console.warn('addToken: No contract address found', rawToken);
    return;
  }

  console.log(`📝 Adding token to leaderboard:`, {
    address: contractAddress,
    symbol: rawToken.symbol,
    source: source,
    hasExisting: centralLeaderboard.has(contractAddress)
  });

  const existing = centralLeaderboard.get(contractAddress);
  
  if (existing) {
    // Update existing token
    const newMarketCap = source === 'bullx' ? 
      (rawToken.peakMarketCap || rawToken.currentMarketCap || 0) :
      (rawToken.marketCapUSD || 0);
    
    // Update peak if new value is higher
    if (newMarketCap > existing.peakMarketCap) {
      existing.peakMarketCap = newMarketCap;
      console.log(`📈 New peak MC for ${existing.symbol}: ${newMarketCap}`);
    }
    
    existing.currentMarketCap = newMarketCap;
    existing.lastUpdated = new Date().toISOString();
    
    // Merge KOLs if new ones provided
    if (rawToken.kols && rawToken.kols.length > 0) {
      rawToken.kols.forEach(kol => {
        if (!existing.kols.includes(kol)) {
          existing.kols.push(kol);
        }
      });
    }
    
  } else {
    // Add new token
    const standardized = standardizeToken(rawToken, source);
    centralLeaderboard.set(contractAddress, standardized);

  }
}

// Update market cap for existing token (for live price updates)
export function updateMarketCap(contractAddress, newMarketCap) {
  const existing = centralLeaderboard.get(contractAddress);
  if (!existing) {
    console.warn(`updateMarketCap: Token not found: ${contractAddress}`);
    return;
  }

  // Update peak if new value is higher
  if (newMarketCap > existing.peakMarketCap) {
    existing.peakMarketCap = newMarketCap;

  }
  
  existing.currentMarketCap = newMarketCap;
  existing.lastUpdated = new Date().toISOString();
}

// Get all tokens for leaderboard display
export function getAllTokens() {
  const tokens = Array.from(centralLeaderboard.values());

  return tokens;
}

// Get single token data
export function getToken(contractAddress) {
  return centralLeaderboard.get(contractAddress) || null;
}

// Get leaderboard stats
export function getStats() {
  const tokens = Array.from(centralLeaderboard.values());
  
  return {
    totalTokens: tokens.length,
    bullXCount: tokens.filter(t => t.source === 'bullx').length,
    pumpFunCount: tokens.filter(t => t.source === 'pumpfun').length,
    topPeakMC: tokens.length > 0 ? Math.max(...tokens.map(t => t.peakMarketCap)) : 0,
    avgPeakMC: tokens.length > 0 ? tokens.reduce((sum, t) => sum + t.peakMarketCap, 0) / tokens.length : 0
  };
}

// Debug function to check store state
export function debugStore() {
  
  const stats = getStats();
  
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
    console.log('⚠️ Duplicate symbols:', duplicates);
  } else {
  }
  
  // Show top 5 by peak MC
  const top5 = Array.from(centralLeaderboard.values())
    .sort((a, b) => b.peakMarketCap - a.peakMarketCap)
    .slice(0, 5);
  

  top5.forEach((token, i) => {
    console.log(`  ${i + 1}. ${token.symbol} - $${token.peakMarketCap.toLocaleString()} (${token.source})`);
  });
  

}

// Clear all data (for testing)
export function clearStore() {
  centralLeaderboard.clear();

}