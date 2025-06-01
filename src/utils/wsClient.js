const KOL_WALLETS = [
  "AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm", // ANSEM
  "EnQLCLB7NWojruXXNopgH7jhkwoHihTpuzsrtsM2UCSe", // ERIK STEPHENS
  "GpaxwRPnFsygJaw1d9uf78Tzt7yDoZr5hBhfWEk7gyRT", // BATMANWIF
  "vQ33AcEii7mciXznW7TAqzpv18Z77PQHxSfJ7xNBHwU", // MARCEL
  "3kebnKw7cPdSkLRfiMEALyZJGZ4wdiSRvmoN4rD1yPzV", // BASTILLE
  "8zFZHuSRuDpuAR7J6FzwyF3vKNx4CVW3DFHJerQhc7Zd", // TRADERPOW
  "4Be9CvxqHW6BYiRAxW9Q3xu1ycTMWaL5z8NX4HR3ha7t", // MITCH
  "B3wagQZiZU2hKa5pUCj6rrdhWsX3Q6WfTTnki9pJwzMh", // XANDER
  "4BukjaBiZgGaha6iniWDLiMRsLPCLxAyGMyjnkM3oPmR", // BIG DAN
  "CRVidEDtEUTYZisCxBZkpELzhQc9eauMLR3FWg74tReL", // FRANKDEGODS
  "Fdv3EQykFyxFpDf6SFB9TuaWdVFtmZeav3hrhrvQzZbM", // TOLY WALLET
  "6nhskL8RVpXzWXC7mcC1UXpe3ze2p6P6og1jXVGUW88s", // PATTY ICE
  "DfMxre4cKmvogbLrPigxmibVTTQDuzjdXojWzjCXXhzj", // EURIS
  "5rkPDK4JnVAumgzeV2Zu8vjggMTtHdDtrsd5o9dhGZHD", // DAVE PORTNOY
  "FXzJ6xwH2HfdKshERVAYiLh79PAUw9zC7ucngupt91ap", // DAVE PORTNOY
  "9CDiPtpPF2xB1VRsR13NeULzuU3X7xirfbqhZWmKcPqJ",
];

// Enhanced market cap validation function
const validateMarketCap = (solAmount, tokenAmount, solPrice) => {
  const sol = Number(solAmount);
  const tokens = Number(tokenAmount);
  const price = Number(solPrice);
  
  // Validate all inputs
  if (isNaN(sol) || isNaN(tokens) || isNaN(price) || tokens <= 0 || sol <= 0) {
    console.warn('🚨 Invalid trade data:', { solAmount, tokenAmount, solPrice });
    return null;
  }
  
  const pricePerToken = sol / tokens;
  const marketCap = pricePerToken * 1_000_000_000 * price;
  
  // Debug logging for suspiciously high prices
  if (pricePerToken > 1) {
    console.log('🔍 High price detected:', {
      solAmount,
      tokenAmount,
      pricePerToken: pricePerToken.toFixed(8),
      marketCapUSD: marketCap.toLocaleString()
    });
  }
  
  // Reject impossible market caps (>$50B is unrealistic for new tokens)
  if (marketCap > 50_000_000_000) {
    console.warn('🚨 Rejected phantom market cap:', {
      sol, 
      tokens, 
      pricePerToken: pricePerToken.toFixed(8), 
      marketCap: marketCap.toLocaleString()
    });
    return null;
  }
  
  return marketCap;
};

export default function setupPumpWebSocket(onMint, onTrade, onKolBuy, solPrice) {
  const ws = new WebSocket("wss://pumpportal.fun/api/data");

  ws.onopen = () => {
    console.log("[WebSocket] ✅ Connected to PumpPortal");
    ws.send(JSON.stringify({ method: "subscribeNewToken" }));
    ws.send(JSON.stringify({ method: "subscribeAccountTrade", keys: KOL_WALLETS }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // 🚀 LOG ALL INCOMING TRANSACTION DATA
      if (data.txType === "create" || data.txType === "buy" || data.txType === "sell") {
        console.log('📦 [PumpFun Transaction]', {
          txType: data.txType,
          mint: data.mint,
          traderPublicKey: data.traderPublicKey,
          solAmount: data.solAmount,
          tokenAmount: data.tokenAmount,
          marketCapSol: data.marketCapSol, // 👈 This is the field you mentioned!
          bondingCurveKey: data.bondingCurveKey,
          vTokensInBondingCurve: data.vTokensInBondingCurve,
          vSolInBondingCurve: data.vSolInBondingCurve,
          marketCapUSD: data.marketCapSol ? data.marketCapSol * solPrice : null,
          timestamp: new Date().toISOString(),
          // Log ALL fields to see what else is available
          allFields: Object.keys(data)
        });
      }

      if (data.txType === "create" && data.mint) {
        onMint(data);
        ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [data.mint] }));
      }

      if ((data.txType === "buy" || data.txType === "sell") && data.solAmount && data.tokenAmount) {
        // Use validated market cap calculation
        const marketCapUSD = validateMarketCap(data.solAmount, data.tokenAmount, solPrice);
        
        // Skip this trade if market cap is invalid
        if (marketCapUSD === null) {
          console.warn('🚨 Skipping trade with invalid market cap');
          return;
        }
        
        const volumeUSD = Number(data.solAmount) * solPrice;

        onTrade({
          mint: data.mint,
          traderPublicKey: data.traderPublicKey,
          txType: data.txType,
          tokenAmount: data.tokenAmount,
          volumeUSD,
          marketCapUSD, // Now validated
        });

        if (KOL_WALLETS.includes(data.traderPublicKey) && data.txType === "buy") {
          onKolBuy({
            mint: data.mint,
            traderPublicKey: data.traderPublicKey,
          });
        }
      }
    } catch (err) {
      console.error("[WebSocket] ❌ Error parsing message", err);
    }
  };

  ws.onerror = (e) => console.error("[WebSocket] ❌ Error", e);
  ws.onclose = () => console.warn("[WebSocket] ❌ Disconnected");

  return ws;
}