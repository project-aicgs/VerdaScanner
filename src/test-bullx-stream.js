import { decode as msgpackDecode } from '@msgpack/msgpack';
import pako from 'pako';
import { addToken, updateMarketCap, getToken } from './utils/leaderboardStore.js';
import { tokenContentAllowed } from './utils/contentFilter.js';
import { KOL_NAMES } from './constants/kolWallets.js';
import { recordWhaleActivity } from './utils/whaleActivityStore.js';

// Two different WebSocket URLs
const WALLET_WS_URL = 'wss://stream4.bullx.io/app/prowess-frail-sensitive?protocol=7&client=js&version=8.4.0-rc2&flash=false';
const TOKEN_WS_URL = 'wss://stream.bullx.io/app/prowess-frail-sensitive?protocol=7&client=js&version=8.4.0-rc2&flash=false';

// Constants
const SOLANA_NATIVE_TOKEN = "So11111111111111111111111111111111111111112";
const CHAIN_ID = "1399811149";

function inferBlockWiseSwapSide(swapData, contractAddress) {
  const sol = SOLANA_NATIVE_TOKEN;
  const ti =
    swapData.tokenIn ||
    swapData.tokenInMint ||
    swapData.inputMint ||
    swapData.fromMint;
  const to =
    swapData.tokenOut ||
    swapData.tokenOutMint ||
    swapData.outputMint ||
    swapData.toMint;
  if (ti === contractAddress && (to === sol || to === SOLANA_NATIVE_TOKEN)) {
    return "sell";
  }
  if ((ti === sol || ti === SOLANA_NATIVE_TOKEN) && to === contractAddress) {
    return "buy";
  }
  if (swapData.txType === "sell" || swapData.side === "sell") return "sell";
  return "buy";
}

// Track which channels we've already logged (to only show first-time data)
const loggedChannels = new Set();

// Track subscribed tokens to avoid duplicate subscriptions
const subscribedTokens = new Set();

// Store data for analysis - KEEP FOR KOL DASHBOARD DISPLAY
const tokenData = new Map();
const transactionData = new Map();
const kolTokensData = new Map();

/** React subscribes for immediate UI/chart updates (polling alone was too slow vs Pump WS). */
const kolTokensListeners = new Set();
let kolNotifyTimeoutId = null;
const KOL_NOTIFY_THROTTLE_MS = 120;

/** One row per smart-wallet buy — sidebar feed (newest first). */
const kolTxLog = [];
const kolBuyEventsById = new Map();
const kolLoggedEventIds = new Set();
const kolTxListeners = new Set();
let kolTxNotifyTimeoutId = null;
const KOL_TX_NOTIFY_THROTTLE_MS = 120;

function scheduleKolTokensNotify() {
  if (kolTokensListeners.size === 0) return;
  if (kolNotifyTimeoutId != null) return;
  kolNotifyTimeoutId = window.setTimeout(() => {
    kolNotifyTimeoutId = null;
    const snapshot = Array.from(kolTokensData.values());
    kolTokensListeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch (e) {
        console.error("[BullX] kolTokens listener error", e);
      }
    });
  }, KOL_NOTIFY_THROTTLE_MS);
}

function scheduleKolTxNotify() {
  if (kolTxListeners.size === 0) return;
  if (kolTxNotifyTimeoutId != null) return;
  kolTxNotifyTimeoutId = window.setTimeout(() => {
    kolTxNotifyTimeoutId = null;
    const snapshot = [...kolTxLog];
    kolTxListeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch (e) {
        console.error("[BullX] kolTx listener error", e);
      }
    });
  }, KOL_TX_NOTIFY_THROTTLE_MS);
}

/** @param {(tokens: object[]) => void} listener */
export function subscribeKolTokens(listener) {
  if (typeof listener !== "function") return () => {};
  kolTokensListeners.add(listener);
  return () => {
    kolTokensListeners.delete(listener);
  };
}

/** @param {(rows: object[]) => void} listener */
export function subscribeKolTransactions(listener) {
  if (typeof listener !== "function") return () => {};
  kolTxListeners.add(listener);
  return () => {
    kolTxListeners.delete(listener);
  };
}

export function getKolTransactions() {
  return [...kolTxLog];
}

// WebSocket connections
let walletWs = null;
let tokenWs = null;
let isMonitoring = false;

// Reconnection management
let walletPingInterval = null;
let tokenPingInterval = null;
let healthCheckInterval = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Function to decode data (browser compatible)
function decodeData(data) {
  try {
    if (data && typeof data === 'object' && data.type === "Buffer" && Array.isArray(data.data)) {
      const uint8Array = new Uint8Array(data.data);
      try {
        return msgpackDecode(uint8Array); // Use msgpackDecode here
      } catch (e) {
        return new TextDecoder().decode(uint8Array);
      }
    }
    
    if (typeof data === 'string' && data.includes(',')) {
      const numberArray = data.split(',').map(num => parseInt(num.trim(), 10));
      if (numberArray.some(isNaN)) return null;

      const compressedBuffer = new Uint8Array(numberArray);
      const decompressed = pako.inflate(compressedBuffer);
      const decompressedString = new TextDecoder().decode(decompressed);
      
      return JSON.parse(decompressedString);
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

// Function to subscribe to token-specific channels
function subscribeToToken(contractAddress) {
  if (subscribedTokens.has(contractAddress)) {
    return;
  }

  // Complete subscription set required for blockWiseSwaps to work
  const tokenSubscriptions = [
    `token_updates_${contractAddress}_${CHAIN_ID}`,
    `liquidityPoolsV2_${contractAddress}_${SOLANA_NATIVE_TOKEN}_${CHAIN_ID}`,
    `user-updates-0x1b39ed5a1c58a49ab21367dcdc8ab3065eeb64fa`,
    `blockWiseSwaps_${contractAddress}_${SOLANA_NATIVE_TOKEN}`,
    `blockhash`
  ];

  tokenSubscriptions.forEach(channel => {
    const subscribeMessage = {
      event: "pusher:subscribe",
      data: { auth: "", channel }
    };
    
    if (tokenWs && tokenWs.readyState === WebSocket.OPEN) {
      tokenWs.send(JSON.stringify(subscribeMessage));
    }
  });

  subscribedTokens.add(contractAddress);
}

// Helper function for formatting
function formatMarketCapSimple(value) {
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

// Function to calculate actual supply
function calculateActualSupply(totalSupply, decimals) {
  if (!totalSupply || decimals === undefined) return null;
  
  // Ensure we're working with valid numbers
  const supply = parseFloat(totalSupply);
  const dec = parseInt(decimals);
  
  if (isNaN(supply) || isNaN(dec)) {
    // console.warn('Invalid supply or decimals:', { totalSupply, decimals });
    return null;
  }
  
  return supply / Math.pow(10, dec);
}

// Function to fix IPFS URLs
function fixIpfsUrl(url) {
  if (!url || !url.includes('ipfs/')) return url;
  
  const ipfsHash = url.split('ipfs/')[1];
  return `https://ipfs.io/ipfs/${ipfsHash}`;
}

function isValidBuyMc(v) {
  return v != null && Number.isFinite(v) && v > 0;
}

// Function to display formatted analysis AND add to leaderboard store
function displayAnalysis(contractAddress) {
  const token = tokenData.get(contractAddress);
  const transaction = transactionData.get(contractAddress);
  
  if (!token || !transaction) {
    return;
  }
  
  const actualSupply = calculateActualSupply(token.totalSupply, token.decimals);
  const priceUSD = transaction.suspectedBaseTokenPriceUSD;
  
  // Calculate market cap
  let marketCap = null;
  if (actualSupply && priceUSD) {
    marketCap = actualSupply * parseFloat(priceUSD);
  }
  
  const tokensPurchased = parseFloat(transaction.amountOut) / Math.pow(10, token.decimals);
  const usdSpent = parseFloat(transaction.amountUSD);
  const ownershipPercentage = actualSupply ? (tokensPurchased / actualSupply) * 100 : null;

  // Store formatted data for React components (KOL dashboard display)
  // Note: do NOT put buyMarketCapUSD on kolTokenData — token_updates recalculates marketCap every tick
  // and would reintroduce a drifting "buy" MC via Object.assign.
  const kolTokenData = {
    mint: contractAddress,
    name: token.name || "Unnamed",
    symbol: token.symbol || "???",
    image: fixIpfsUrl(token.logo) || "",
    description: token.description || "",
    marketCapUSD: marketCap || 0,
    priceUSD: parseFloat(priceUSD) || 0,
    supply: actualSupply || 0,
    usdSpent: usdSpent || 0,
    tokensPurchased: tokensPurchased || 0,
    ownershipPercentage: ownershipPercentage || 0,
    website: token.website || token.links?.website || "",
    twitter: token.links?.twitter || "",
    kols: [transaction.kolName || "UNKNOWN"]
  };

  const existing = kolTokensData.get(contractAddress);
  if (existing) {
    if (!existing.kols.includes(kolTokenData.kols[0])) {
      existing.kols.push(kolTokenData.kols[0]);
    }
    Object.assign(existing, kolTokenData, { kols: existing.kols });
    // Lock purchase MC once (first time we have a real figure). Never overwrite on later token_updates.
    if (!isValidBuyMc(existing.buyMarketCapUSD) && isValidBuyMc(marketCap)) {
      existing.buyMarketCapUSD = marketCap;
    }
  } else {
    const row = { ...kolTokenData };
    if (isValidBuyMc(marketCap)) {
      row.buyMarketCapUSD = marketCap;
    }
    kolTokensData.set(contractAddress, row);
  }

  const buyEventId = transaction._kolBuyEventId;
  if (buyEventId && kolBuyEventsById.has(buyEventId) && !kolLoggedEventIds.has(buyEventId)) {
    if (ownershipPercentage != null && Number.isFinite(ownershipPercentage) && ownershipPercentage >= 10) {
      kolBuyEventsById.delete(buyEventId);
    } else if (
      isValidBuyMc(marketCap) &&
      ownershipPercentage != null &&
      Number.isFinite(ownershipPercentage)
    ) {
      kolLoggedEventIds.add(buyEventId);
      const pending = kolBuyEventsById.get(buyEventId);
      kolBuyEventsById.delete(buyEventId);
      kolTxLog.unshift({
        id: buyEventId,
        mint: contractAddress,
        kolName: transaction.kolName,
        kolWallet: pending.kolWallet,
        symbol: token.symbol || "???",
        name: token.name || "Unnamed",
        ownershipPercentage,
        buyMarketCapUSD: marketCap,
        usdSpent,
        tokensPurchased,
        ts: pending.ts,
      });
      if (kolTxLog.length > 500) kolTxLog.length = 500;
      scheduleKolTxNotify();
    }
  }

  scheduleKolTokensNotify();

  // console.log(`✅ BullX Token Analysis Complete:`, {
  //   symbol: token.symbol,
  //   marketCap: formatMarketCapSimple(marketCap),
  //   priceUSD: priceUSD,
  //   actualSupply: actualSupply,
  //   decimals: token.decimals
  // });
  
  try {
    // Check if token already exists in store before adding
    const existingInStore = getToken(contractAddress);
    
    if (!existingInStore) {
      const sym = token.symbol || "???";
      const nm = token.name || "Unnamed";
      if (!tokenContentAllowed(sym, nm)) {
        // console.warn(`⛔ Skipping leaderboard add (content filter): ${sym}`);
        return;
      }
      addToken({
        contractAddress: contractAddress,
        symbol: sym,
        name: nm,
        image: token.logo,
        description: token.description || "",
        initialMarketCap: marketCap || 0,
        peakMarketCap: marketCap || 0,
        currentMarketCap: marketCap || 0,
        volumeUSD: usdSpent || 0, // Include volume from transaction
        kols: [transaction.kolName || "UNKNOWN"]
      }, 'bullx');
      
      // console.log(`✅ Added BullX token to leaderboard: ${token.symbol}`);
    } else {
      // Update existing token with new KOL if needed
      if (transaction.kolName && !existingInStore.kols.includes(transaction.kolName)) {
        existingInStore.kols.push(transaction.kolName);
      }
    }
    
  } catch (error) {
    // console.error('❌ Error adding BullX token to leaderboard:', error);
  }
}

// Function to clear intervals
function clearAllIntervals() {
  if (walletPingInterval) clearInterval(walletPingInterval);
  if (tokenPingInterval) clearInterval(tokenPingInterval);
  if (healthCheckInterval) clearInterval(healthCheckInterval);
  walletPingInterval = null;
  tokenPingInterval = null;
  healthCheckInterval = null;
}

// Function to resubscribe to all KOL wallets
function resubscribeWallets() {
  if (walletWs && walletWs.readyState === WebSocket.OPEN) {
    Object.keys(KOL_NAMES).forEach(walletAddress => {
      const channel = `walletWiseSwaps_${walletAddress}`;
      const subscribeMessage = {
        event: "pusher:subscribe",
        data: { auth: "", channel }
      };
      walletWs.send(JSON.stringify(subscribeMessage));
    });
  }
}

// Function to resubscribe to all token channels
function resubscribeTokens() {
  if (tokenWs && tokenWs.readyState === WebSocket.OPEN) {
    subscribedTokens.forEach(contractAddress => {
      const tokenSubscriptions = [
        `token_updates_${contractAddress}_${CHAIN_ID}`,
        `liquidityPoolsV2_${contractAddress}_${SOLANA_NATIVE_TOKEN}_${CHAIN_ID}`,
        `user-updates-0x1b39ed5a1c58a49ab21367dcdc8ab3065eeb64fa`,
        `blockWiseSwaps_${contractAddress}_${SOLANA_NATIVE_TOKEN}`,
        `blockhash`
      ];

      tokenSubscriptions.forEach(channel => {
        const subscribeMessage = {
          event: "pusher:subscribe",
          data: { auth: "", channel }
        };
        tokenWs.send(JSON.stringify(subscribeMessage));
      });
    });
  }
}

// Create WebSocket connections with auto-reconnection
function createWebSocketConnections() {
  if (walletWs) walletWs.close();
  if (tokenWs) tokenWs.close();
  clearAllIntervals();

  walletWs = new WebSocket(WALLET_WS_URL);
  tokenWs = new WebSocket(TOKEN_WS_URL);

  // WALLET WEBSOCKET
  walletWs.onopen = () => {
    // console.log('✅ BullX Wallet WebSocket connected');
    reconnectAttempts = 0;
    resubscribeWallets();

    walletPingInterval = setInterval(() => {
      if (walletWs && walletWs.readyState === WebSocket.OPEN) {
        walletWs.send(JSON.stringify({ event: "ping", data: {} }));
      }
    }, 10000);
  };

  walletWs.onmessage = (event) => {
    try {
      const parsedData = JSON.parse(event.data);

      if (parsedData.event && parsedData.event.startsWith('walletWiseSwaps_')) {
        const decodedData = decodeData(parsedData.data);
        if (decodedData && decodedData.data && decodedData.data.length > 0) {
          const tx = decodedData.data[0];
          
          if (tx.tokenIn === SOLANA_NATIVE_TOKEN && tx.tokenOut !== SOLANA_NATIVE_TOKEN) {
            const contractAddress = tx.tokenOut;
            const walletAddress = parsedData.event.replace('walletWiseSwaps_', '');
            const kolName = KOL_NAMES[walletAddress] || 'UNKNOWN';
            
            tx.kolName = kolName;
            tx.kolWallet = walletAddress;

            const prev = transactionData.get(contractAddress);
            if (prev && prev._kolBuyEventId) {
              kolBuyEventsById.delete(prev._kolBuyEventId);
            }
            const eventId = `kol-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
            tx._kolBuyEventId = eventId;
            kolBuyEventsById.set(eventId, {
              mint: contractAddress,
              kolName,
              kolWallet: walletAddress,
              ts: Date.now(),
            });

            transactionData.set(contractAddress, tx);
            subscribeToToken(contractAddress);
            
            displayAnalysis(contractAddress);
          }
        }
      }
    } catch (error) {
      // Silent
    }
  };

  walletWs.onclose = (event) => {
    // console.warn('❌ BullX Wallet WebSocket disconnected');
    if (isMonitoring && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      setTimeout(() => {
        if (isMonitoring) createWebSocketConnections();
      }, 5000);
    }
  };

  walletWs.onerror = (err) => {
    // Silent
  };

  // TOKEN WEBSOCKET
  tokenWs.onopen = () => {
    // console.log('✅ BullX Token WebSocket connected');
    resubscribeTokens();

    tokenPingInterval = setInterval(() => {
      if (tokenWs && tokenWs.readyState === WebSocket.OPEN) {
        tokenWs.send(JSON.stringify({ event: "ping", data: {} }));
      }
    }, 10000);
  };

  tokenWs.onmessage = (event) => {
    try {
      const parsedData = JSON.parse(event.data);

      // ONLY LOG THE FIRST TIME WE SEE EACH CHANNEL TYPE
      if (parsedData.event && (
          parsedData.event.startsWith('token_updates_') ||
          parsedData.event.startsWith('liquidityPoolsV2_') ||
          parsedData.event.startsWith('blockWiseSwaps_') ||
          parsedData.event.startsWith('user-updates-') ||
          parsedData.event.startsWith('blockhash')
        )) {
        
        const channelType = parsedData.event.split('_')[0] + '_' + parsedData.event.split('_')[1];
        
        if (!loggedChannels.has(channelType)) {
          loggedChannels.add(channelType);
        }
      }

      // Process blockWiseSwaps for live price updates
      if (parsedData.event && parsedData.event.startsWith('blockWiseSwaps_')) {
        let swapDataDecoded;
        if (typeof parsedData.data === 'string') {
          try {
            swapDataDecoded = JSON.parse(parsedData.data);
          } catch (e) {
            swapDataDecoded = decodeData(parsedData.data);
          }
        } else {
          swapDataDecoded = parsedData.data;
        }
        
        if (swapDataDecoded && swapDataDecoded.data && swapDataDecoded.data.length > 0) {
          const swapData = swapDataDecoded.data[0];
          const contractAddress = parsedData.event.split('_')[1];

          const swapVolUsd = Number(swapData.amountUSD) || 0;
          if (swapVolUsd >= 500) {
            const side = inferBlockWiseSwapSide(swapData, contractAddress);
            recordWhaleActivity(contractAddress, {
              side,
              volumeUSD: swapVolUsd,
              source: "dex",
            });
          }

          // Get live price from swap
          const livePriceUSD = swapData.suspectedBaseTokenPriceUSD;
          
          if (livePriceUSD && tokenData.has(contractAddress)) {
            const tokenInfo = tokenData.get(contractAddress);
            const actualSupply = calculateActualSupply(
              tokenInfo.totalSupply,
              tokenInfo.decimals
            );
            const p = parseFloat(livePriceUSD);
            if (actualSupply && Number.isFinite(p) && p > 0) {
              const currentMarketCap = actualSupply * p;
              const tokenInStore = getToken(contractAddress);
              if (tokenInStore) {
                const volumeUSD = swapData.amountUSD || 0;
                updateMarketCap(contractAddress, currentMarketCap, volumeUSD);
              }
              // Keep Smart Wallet strip + modal chart in sync with swap stream (was leaderboard-only).
              if (kolTokensData.has(contractAddress)) {
                const kolRow = kolTokensData.get(contractAddress);
                kolRow.marketCapUSD = currentMarketCap;
                kolRow.priceUSD = p;
                // buyMarketCapUSD unchanged — purchase snapshot for UI
                scheduleKolTokensNotify();
              }
            }
          }
        }
      }

      // Process token updates normally
      if (parsedData.event && parsedData.event.startsWith('token_updates_')) {
        let tokenDataDecoded;
        if (typeof parsedData.data === 'string') {
          try {
            tokenDataDecoded = JSON.parse(parsedData.data);
          } catch (e) {
            tokenDataDecoded = decodeData(parsedData.data);
          }
        } else {
          tokenDataDecoded = parsedData.data;
        }
        
        if (tokenDataDecoded) {
          const contractAddress = tokenDataDecoded.address;
          if (contractAddress) {
            tokenData.set(contractAddress, tokenDataDecoded);
            
            // Update leaderboard with latest market cap if token exists in store
            const transaction = transactionData.get(contractAddress);
            if (transaction) {
              const actualSupply = calculateActualSupply(tokenDataDecoded.totalSupply, tokenDataDecoded.decimals);
              const priceUSD = transaction.suspectedBaseTokenPriceUSD || tokenDataDecoded.priceUSD;
              
              if (actualSupply && priceUSD) {
                const currentMarketCap = actualSupply * parseFloat(priceUSD);
                
                // Check if token exists before updating
                const tokenInStore = getToken(contractAddress);
                if (tokenInStore) {
                  updateMarketCap(contractAddress, currentMarketCap, transaction.amountUSD || 0);
                }
              }
            }
            
            displayAnalysis(contractAddress);
          }
        }
      }

    } catch (error) {
      // Silent
    }
  };

  tokenWs.onclose = (event) => {
    // console.warn('❌ BullX Token WebSocket disconnected');
  };

  tokenWs.onerror = (err) => {
    // Silent
  };

  // Health check every 60 seconds
  healthCheckInterval = setInterval(() => {
    if (isMonitoring) {
      const walletAlive = walletWs && walletWs.readyState === WebSocket.OPEN;
      const tokenAlive = tokenWs && tokenWs.readyState === WebSocket.OPEN;
      
      if (!walletAlive || !tokenAlive) {
        // console.log('🔄 Reconnecting BullX WebSockets...');
        createWebSocketConnections();
      }
    }
  }, 60000);
}

// EXPORTED FUNCTIONS FOR OTHER FILES

export function startBullXMonitoring() {
  if (isMonitoring) return;
  
  // console.log('🚀 Starting BullX monitoring...');
  isMonitoring = true;
  reconnectAttempts = 0;
  createWebSocketConnections();
}

export function getKolTokens() {
  return Array.from(kolTokensData.values());
}

export function getTokenData(contractAddress) {
  return kolTokensData.get(contractAddress) || null;
}

export function isMonitoringActive() {
  return isMonitoring && 
         walletWs && walletWs.readyState === WebSocket.OPEN && 
         tokenWs && tokenWs.readyState === WebSocket.OPEN;
}

export function getConnectionHealth() {
  return {
    isMonitoring,
    walletConnected: walletWs ? walletWs.readyState === WebSocket.OPEN : false,
    tokenConnected: tokenWs ? tokenWs.readyState === WebSocket.OPEN : false,
    reconnectAttempts,
    subscribedTokensCount: subscribedTokens.size,
    trackedTokensCount: kolTokensData.size
  };
}

export function stopBullXMonitoring() {
  // console.log('🛑 Stopping BullX monitoring...');
  isMonitoring = false;
  reconnectAttempts = 0;
  
  clearAllIntervals();
  
  if (walletWs) {
    walletWs.close();
    walletWs = null;
  }
  
  if (tokenWs) {
    tokenWs.close();
    tokenWs = null;
  }
}

// DEBUG: Function to check BullX processing
export function debugBullX() {
  // console.log('🔍 BullX Debug Info:', {
  //   monitoring: isMonitoring,
  //   walletConnected: walletWs?.readyState === WebSocket.OPEN,
  //   tokenConnected: tokenWs?.readyState === WebSocket.OPEN,
  //   subscribedTokens: subscribedTokens.size,
  //   trackedKolTokens: kolTokensData.size,
  //   tokenDataSize: tokenData.size,
  //   transactionDataSize: transactionData.size
  // });

  // Array.from(kolTokensData.values()).slice(0, 3).forEach((token) => {
  //   console.log(`Token: ${token.symbol}`, { ... });
  // });
}

export { KOL_NAMES };