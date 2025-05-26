import { decode as msgpackDecode } from '@msgpack/msgpack';
import pako from 'pako';
import { addToken, updateMarketCap } from '../src/utils/leaderboardStore.js';

// Two different WebSocket URLs
const WALLET_WS_URL = 'wss://stream4.bullx.io/app/prowess-frail-sensitive?protocol=7&client=js&version=8.4.0-rc2&flash=false';
const TOKEN_WS_URL = 'wss://stream.bullx.io/app/prowess-frail-sensitive?protocol=7&client=js&version=8.4.0-rc2&flash=false';

// Constants
const SOLANA_NATIVE_TOKEN = "So11111111111111111111111111111111111111112";
const CHAIN_ID = "1399811149";

// KOL wallet addresses with corresponding names
const KOL_NAMES = {
  "GpaxwRPnFsygJaw1d9uf78Tzt7yDoZr5hBhfWEk7gyRT": "BATMANWIF",
  "9CDiPtpPF2xB1VRsR13NeULzuU3X7xirfbqhZWmKcPqJ": "TEST ADDY",
  "EnQLCLB7NWojruXXNopgH7jhkwoHihTpuzsrtsM2UCSe": "ERIK STEPHENS",
  "AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm": "ANSEM",
  "vQ33AcEii7mciXznW7TAqzpv18Z77PQHxSfJ7xNBHwU": "MARCEL",
  "3kebnKw7cPdSkLRfiMEALyZJGZ4wdiSRvmoN4rD1yPzV": "BASTILLE",
  "8zFZHuSRuDpuAR7J6FzwyF3vKNx4CVW3DFHJerQhc7Zd": "TRADERPOW",
  "4Be9CvxqHW6BYiRAxW9Q3xu1ycTMWaL5z8NX4HR3ha7t": "MITCH",
  "B3wagQZiZU2hKa5pUCj6rrdhWsX3Q6WfTTnki9pJwzMh": "XANDER",
  "4BukjaBiZgGaha6iniWDLiMRsLPCLxAyGMyjnkM3oPmR": "BIG DAN",
  "CRVidEDtEUTYZisCxBZkpELzhQc9eauMLR3FWg74tReL": "FRANKDEGODS",
  "Fdv3EQykFyxFpDf6SFB9TuaWdVFtmZeav3hrhrvQzZbM": "TOLY WALLET",
  "6nhskL8RVpXzWXC7mcC1UXpe3ze2p6P6og1jXVGUW88s": "PATTY ICE",
  "DfMxre4cKmvogbLrPigxmibVTTQDuzjdXojWsX3Q6WfTTnki9pJwzMh": "EURIS",
  "5rkPDK4JnVAumgzeV2Zu8vjggMTtHdDtrsd5o9dhGZHD": "DAVE PORTNOY",
  "FXzJ6xwH2HfdKshERVAYiLh79PAUw9zC7ucngupt91ap": "DAVE PORTNOY",
};

// Track which channels we've already logged (to only show first-time data)
const loggedChannels = new Set();

// Track subscribed tokens to avoid duplicate subscriptions
const subscribedTokens = new Set();

// Store data for analysis - KEEP FOR KOL DASHBOARD DISPLAY
const tokenData = new Map();
const transactionData = new Map();
const kolTokensData = new Map();

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
  return parseFloat(totalSupply) / Math.pow(10, decimals);
}

// Function to fix IPFS URLs
function fixIpfsUrl(url) {
  if (!url || !url.includes('ipfs/')) return url;
  
  const ipfsHash = url.split('ipfs/')[1];
  return `https://ipfs.io/ipfs/${ipfsHash}`;
}

// SIMPLIFIED: Function to display formatted analysis AND add to leaderboard store
function displayAnalysis(contractAddress) {
  const token = tokenData.get(contractAddress);
  const transaction = transactionData.get(contractAddress);
  
  if (!token || !transaction) {
    return;
  }
  
  const actualSupply = calculateActualSupply(token.totalSupply, token.decimals);
  const priceUSD = transaction.suspectedBaseTokenPriceUSD;
  const marketCap = actualSupply && priceUSD ? actualSupply * parseFloat(priceUSD) : null;
  
  console.log('🔍 BullX Market Cap Calculation Debug:', {
    contractAddress,
    symbol: token.symbol,
    totalSupply: token.totalSupply,
    decimals: token.decimals,
    actualSupply: actualSupply,
    priceUSD: priceUSD,
    calculatedMarketCap: marketCap,
    rawPriceUSD: transaction.suspectedBaseTokenPriceUSD
  });
  
  const tokensPurchased = parseFloat(transaction.amountOut) / Math.pow(10, token.decimals);
  const usdSpent = parseFloat(transaction.amountUSD);
  const ownershipPercentage = actualSupply ? (tokensPurchased / actualSupply) * 100 : null;

  // Store formatted data for React components (KOL dashboard display)
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
  } else {
    kolTokensData.set(contractAddress, kolTokenData);
  }

  // NEW: Add to central leaderboard store
  console.log('🎯 Adding BullX token to leaderboard:', {
    contractAddress,
    symbol: token.symbol,
    marketCap: marketCap,
    kolName: transaction.kolName
  });
  
  try {
    addToken({
      contractAddress: contractAddress,
      symbol: token.symbol || "???",
      name: token.name || "Unnamed",
      image: token.logo,
      description: token.description || "",
      initialMarketCap: marketCap || 0,
      peakMarketCap: marketCap || 0,
      currentMarketCap: marketCap || 0,
      kols: [transaction.kolName || "UNKNOWN"]
    }, 'bullx');
    
    console.log('✅ BullX token added successfully to leaderboard');
  } catch (error) {
    console.error('❌ Error adding BullX token to leaderboard:', error);
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
          
          // Get live price from swap
          const livePriceUSD = swapData.suspectedBaseTokenPriceUSD;
          
          if (livePriceUSD && tokenData.has(contractAddress)) {
            const tokenInfo = tokenData.get(contractAddress);
            if (tokenInfo) {
              const actualSupply = calculateActualSupply(tokenInfo.totalSupply, tokenInfo.decimals);
              
              if (actualSupply) {
                const currentMarketCap = actualSupply * parseFloat(livePriceUSD);
                // NEW: Update market cap in leaderboard store
                updateMarketCap(contractAddress, currentMarketCap);
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
                updateMarketCap(contractAddress, currentMarketCap);
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
    // Silent
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
        createWebSocketConnections();
      }
    }
  }, 60000);
}

// EXPORTED FUNCTIONS FOR OTHER FILES

export function startBullXMonitoring() {
  if (isMonitoring) return;
  
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
  console.log('=== BULLX DEBUG INFO ===');
  console.log('Is monitoring:', isMonitoring);
  console.log('Wallet WS connected:', walletWs?.readyState === WebSocket.OPEN);
  console.log('Token WS connected:', tokenWs?.readyState === WebSocket.OPEN);
  console.log('Subscribed tokens count:', subscribedTokens.size);
  console.log('Token data count:', tokenData.size);
  console.log('Transaction data count:', transactionData.size);
  console.log('KOL tokens data count:', kolTokensData.size);
  
  console.log('Recent KOL tokens:');
  Array.from(kolTokensData.values()).slice(0, 3).forEach(token => {
    console.log(`  ${token.symbol} - ${token.kols.join(', ')}`);
  });
  
  console.log('========================');
}

export { KOL_NAMES };