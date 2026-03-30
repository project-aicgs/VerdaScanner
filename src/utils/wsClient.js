import { KOL_WALLET_ADDRESSES } from "../constants/kolWallets.js";

const KOL_WALLETS = KOL_WALLET_ADDRESSES;

// Enhanced market cap validation function
const validateMarketCap = (solAmount, tokenAmount, solPrice) => {
  const sol = Number(solAmount);
  const tokens = Number(tokenAmount);
  const price = Number(solPrice);
  
  // Validate all inputs
  if (isNaN(sol) || isNaN(tokens) || isNaN(price) || tokens <= 0 || sol <= 0) {
    // console.warn('🚨 Invalid trade data:', { solAmount, tokenAmount, solPrice });
    return null;
  }
  
  const pricePerToken = sol / tokens;
  const marketCap = pricePerToken * 1_000_000_000 * price;
  
  // Debug logging for suspiciously high prices
  if (pricePerToken > 1) {
    // console.log('🔍 High price detected:', {
    //   solAmount,
    //   tokenAmount,
    //   pricePerToken: pricePerToken.toFixed(8),
    //   marketCapUSD: marketCap.toLocaleString()
    // });
  }
  
  // Reject impossible market caps (>$50B is unrealistic for new tokens)
  if (marketCap > 50_000_000_000) {
    // console.warn('🚨 Rejected phantom market cap:', {
    //   sol, 
    //   tokens, 
    //   pricePerToken: pricePerToken.toFixed(8), 
    //   marketCap: marketCap.toLocaleString()
    // });
    return null;
  }
  
  return marketCap;
};

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function setupPumpWebSocket(onMint, onTrade, onKolBuy, solPrice) {
  const ws = new WebSocket("wss://pumpportal.fun/api/data");

  ws.onopen = () => {
    // console.log("[WebSocket] ✅ Connected to PumpPortal");
    ws.send(JSON.stringify({ method: "subscribeNewToken" }));
    ws.send(JSON.stringify({ method: "subscribeAccountTrade", keys: KOL_WALLETS }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // 🚀 LOG ALL INCOMING TRANSACTION DATA
      if (data.txType === "create" || data.txType === "buy" || data.txType === "sell") {
        // console.log('📦 [PumpFun Transaction]', {
        //   txType: data.txType,
        //   mint: data.mint,
        //   traderPublicKey: data.traderPublicKey,
        //   solAmount: data.solAmount,
        //   tokenAmount: data.tokenAmount,
        //   marketCapSol: data.marketCapSol,
        //   bondingCurveKey: data.bondingCurveKey,
        //   vTokensInBondingCurve: data.vTokensInBondingCurve,
        //   vSolInBondingCurve: data.vSolInBondingCurve,
        //   marketCapUSD: data.marketCapSol ? data.marketCapSol * solPrice : null,
        //   timestamp: new Date().toISOString(),
        //   allFields: Object.keys(data)
        // });
      }

      if (data.txType === "create" && data.mint) {
        onMint(data);
        ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [data.mint] }));
      }

      if ((data.txType === "buy" || data.txType === "sell") && data.solAmount && data.tokenAmount) {
        // Use marketCapSol if available, otherwise calculate
        let marketCapUSD;
        if (data.marketCapSol) {
          marketCapUSD = data.marketCapSol * solPrice;
        } else {
          // Use validated market cap calculation
          marketCapUSD = validateMarketCap(data.solAmount, data.tokenAmount, solPrice);
        }
        
        // Skip this trade if market cap is invalid
        if (marketCapUSD === null) {
          // console.warn('🚨 Skipping trade with invalid market cap');
          return;
        }
        
        const volumeUSD = Number(data.solAmount) * solPrice;

        onTrade({
          mint: data.mint,
          traderPublicKey: data.traderPublicKey,
          txType: data.txType,
          tokenAmount: data.tokenAmount,
          volumeUSD,
          marketCapUSD,
          solAmount: data.solAmount, // Pass raw SOL amount for validation
          /** SOL-notional along bonding curve (~85 SOL at graduation → PumpSwap). */
          marketCapSol: numOrNull(data.marketCapSol),
          vSolInBondingCurve: numOrNull(data.vSolInBondingCurve),
          vTokensInBondingCurve: numOrNull(data.vTokensInBondingCurve),
        });

        if (KOL_WALLETS.includes(data.traderPublicKey) && data.txType === "buy") {
          onKolBuy({
            mint: data.mint,
            traderPublicKey: data.traderPublicKey,
          });
        }
      }
    } catch (err) {
      // console.error("[WebSocket] ❌ Error parsing message", err);
    }
  };

  ws.onerror = () => {};
  ws.onclose = () => {};

  return ws;
}