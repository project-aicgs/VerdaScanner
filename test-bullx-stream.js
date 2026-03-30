import msgpack from 'msgpack-lite';
import pako from 'pako';
import { KOL_NAMES } from './src/constants/kolWallets.js';

// Two different WebSocket URLs
const WALLET_WS_URL = 'wss://stream4.bullx.io/app/prowess-frail-sensitive?protocol=7&client=js&version=8.4.0-rc2&flash=false';
const TOKEN_WS_URL = 'wss://stream.bullx.io/app/prowess-frail-sensitive?protocol=7&client=js&version=8.4.0-rc2&flash=false';

// Constants
const SOLANA_NATIVE_TOKEN = "So11111111111111111111111111111111111111112";
const CHAIN_ID = "1399811149";

// Track subscribed tokens to avoid duplicate subscriptions
const subscribedTokens = new Set();

// Store data for analysis - EXPORTED FOR OTHER FILES
const tokenData = new Map();
const transactionData = new Map();
const kolTokensData = new Map(); // Store formatted KOL token data

// WebSocket connections
let walletWs = null;
let tokenWs = null;
let isMonitoring = false;

// Function to decode data (browser compatible)
function decodeData(data) {
  try {
    // Handle MessagePack format (JSON with data array)
    if (data && typeof data === 'object' && data.type === "Buffer" && Array.isArray(data.data)) {
      const uint8Array = new Uint8Array(data.data);
      try {
        return msgpack.decode(uint8Array);
      } catch (e) {
        return new TextDecoder().decode(uint8Array);
      }
    }
    
    // Handle zlib format (comma-separated string)
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
    console.error('Decode error:', e.message);
    return null;
  }
}

// Function to subscribe to token-specific channels
function subscribeToToken(contractAddress) {
  if (subscribedTokens.has(contractAddress)) {
    return;
  }

  const tokenSubscriptions = [
    `token_updates_${contractAddress}_${CHAIN_ID}`,
    `liquidityPoolsV2_${contractAddress}_${SOLANA_NATIVE_TOKEN}_${CHAIN_ID}`,
    `blockWiseSwaps_${contractAddress}_${SOLANA_NATIVE_TOKEN}`,
    `blockWiseFullWalletUpdates_${contractAddress}`
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

// Function to calculate actual supply (divide by 10^decimals)
function calculateActualSupply(totalSupply, decimals) {
  if (!totalSupply || decimals === undefined) return null;
  return parseFloat(totalSupply) / Math.pow(10, decimals);
}

// Function to display formatted analysis AND store data for React
function displayAnalysis(contractAddress) {
  const token = tokenData.get(contractAddress);
  const transaction = transactionData.get(contractAddress);
  
  console.log(`\n🔍 DEBUG - Contract: ${contractAddress}`);
  console.log(`   Token data exists: ${!!token}`);
  console.log(`   Transaction data exists: ${!!transaction}`);
  
  if (transaction) {
    console.log(`   Transaction amountOut: ${transaction.amountOut}`);
    console.log(`   Transaction amountUSD: ${transaction.amountUSD}`);
    console.log(`   Transaction price: ${transaction.suspectedBaseTokenPriceUSD}`);
  }
  
  if (token) {
    console.log(`   Token decimals: ${token.decimals}`);
    console.log(`   Token supply: ${token.totalSupply}`);
  }
  
  if (!token || !transaction) {
    console.log(`   ⏳ Waiting for ${!token ? 'token' : ''} ${!transaction ? 'transaction' : ''} data...`);
    return;
  }
  
  const actualSupply = calculateActualSupply(token.totalSupply, token.decimals);
  const priceUSD = transaction.suspectedBaseTokenPriceUSD;
  const marketCap = actualSupply && priceUSD ? actualSupply * parseFloat(priceUSD) : null;
  
  // Calculate tokens purchased using amountOut divided by 10^decimals
  const tokensPurchased = parseFloat(transaction.amountOut) / Math.pow(10, token.decimals);
  const usdSpent = parseFloat(transaction.amountUSD);
  const ownershipPercentage = actualSupply ? (tokensPurchased / actualSupply) * 100 : null;
  
  console.log(`   Calculated tokens purchased: ${tokensPurchased}`);
  console.log(`   Calculated ownership: ${ownershipPercentage}%`);
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 FORMATTED ANALYSIS');
  console.log('='.repeat(80));
  
  console.log('\n💰 FINANCIAL DATA:');
  console.log(`   Supply: ${actualSupply ? actualSupply.toLocaleString() : 'N/A'} tokens`);
  console.log(`   Price: $${priceUSD || 'N/A'}`);
  console.log(`   Market Cap: $${marketCap ? marketCap.toLocaleString() : 'N/A'}`);
  
  console.log('\n🛒 PURCHASE DETAILS:');
  console.log(`   USD Spent: $${usdSpent || 'N/A'}`);
  console.log(`   Tokens Purchased: ${tokensPurchased ? tokensPurchased.toLocaleString() : 'N/A'}`);
  console.log(`   Ownership: ${ownershipPercentage ? ownershipPercentage.toFixed(4) + '%' : 'N/A'} of total supply`);
  
  console.log('\n📋 METADATA:');
  console.log(`   Name: ${token.name || 'N/A'}`);
  console.log(`   Symbol: ${token.symbol || 'N/A'}`);
  console.log(`   Contract: ${token.address || contractAddress}`);
  console.log(`   Description: ${token.description || 'N/A'}`);
  console.log(`   Logo: ${token.logo || 'N/A'}`);
  console.log(`   Website: ${token.website || token.links?.website || 'N/A'}`);
  console.log(`   Twitter: ${token.links?.twitter || 'N/A'}`);
  
  console.log('='.repeat(80));

  // Store formatted data for React components
  const kolTokenData = {
    mint: contractAddress,
    name: token.name || "Unnamed",
    symbol: token.symbol || "???",
    image: token.logo || "",
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

  // Store or update KOL token data
  const existing = kolTokensData.get(contractAddress);
  if (existing) {
    // Add KOL to existing token if not already there
    if (!existing.kols.includes(kolTokenData.kols[0])) {
      existing.kols.push(kolTokenData.kols[0]);
    }
    // Update with latest data
    Object.assign(existing, kolTokenData, { kols: existing.kols });
  } else {
    kolTokensData.set(contractAddress, kolTokenData);
  }
}

// Create WebSocket connections
function createWebSocketConnections() {
  walletWs = new WebSocket(WALLET_WS_URL);
  tokenWs = new WebSocket(TOKEN_WS_URL);

  // WALLET WEBSOCKET
  walletWs.onopen = () => {
    console.log('🚀 WALLET WebSocket connection established (stream4.bullx.io)');

    Object.keys(KOL_NAMES).forEach(walletAddress => {
      const channel = `walletWiseSwaps_${walletAddress}`;
      const subscribeMessage = {
        event: "pusher:subscribe",
        data: { auth: "", channel }
      };

      walletWs.send(JSON.stringify(subscribeMessage));
      console.log(`📡 Wallet WS - Subscribed to: ${KOL_NAMES[walletAddress]} (${walletAddress})`);
    });

    // Keepalive ping
    setInterval(() => {
      if (walletWs && walletWs.readyState === WebSocket.OPEN) {
        walletWs.send(JSON.stringify({ event: "ping", data: {} }));
      }
    }, 30000);
  };

  walletWs.onmessage = (event) => {
    try {
      const parsedData = JSON.parse(event.data);

      // Process wallet transactions - only track BUY transactions
      if (parsedData.event && parsedData.event.startsWith('walletWiseSwaps_')) {
        const decodedData = decodeData(parsedData.data);
        if (decodedData) {
          // Extract contract address and subscribe to token channels
          if (decodedData.data && decodedData.data.length > 0) {
            const tx = decodedData.data[0];
            
            // Only track BUY transactions (SOL -> Memecoin)
            if (tx.tokenIn === SOLANA_NATIVE_TOKEN && tx.tokenOut !== SOLANA_NATIVE_TOKEN) {
              const contractAddress = tx.tokenOut;
              const walletAddress = parsedData.event.replace('walletWiseSwaps_', '');
              const kolName = KOL_NAMES[walletAddress] || 'UNKNOWN';
              
              console.log(`\n🟢 ${kolName} BOUGHT ${contractAddress}`);
              
              // Store transaction data with KOL info
              tx.kolName = kolName;
              tx.kolWallet = walletAddress;
              transactionData.set(contractAddress, tx);
              subscribeToToken(contractAddress);
              
              // Try to display analysis if we have token data
              displayAnalysis(contractAddress);
            }
            // Ignore sells and other transaction types silently
          }
        }
      }

    } catch (error) {
      console.error('❌ Wallet WS - Error parsing data:', error);
    }
  };

  // TOKEN WEBSOCKET
  tokenWs.onopen = () => {
    console.log('🚀 TOKEN WebSocket connection established (stream.bullx.io)');

    // Keepalive ping
    setInterval(() => {
      if (tokenWs && tokenWs.readyState === WebSocket.OPEN) {
        tokenWs.send(JSON.stringify({ event: "ping", data: {} }));
      }
    }, 30000);
  };

  tokenWs.onmessage = (event) => {
    try {
      const parsedData = JSON.parse(event.data);

      // Process token updates - store data and try to display analysis
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
          // Store token data
          const contractAddress = tokenDataDecoded.address;
          if (contractAddress) {
            tokenData.set(contractAddress, tokenDataDecoded);
            // Try to display analysis if we have transaction data
            displayAnalysis(contractAddress);
          }
        }
      }

      // Silently ignore liquidity pool updates and other events

    } catch (error) {
      console.error('❌ Token WS - Error parsing data:', error);
    }
  };

  // WebSocket close events
  walletWs.onclose = () => {
    console.log('🔌 WALLET WebSocket connection closed');
  };

  tokenWs.onclose = () => {
    console.log('🔌 TOKEN WebSocket connection closed');
  };

  // WebSocket error events
  walletWs.onerror = (err) => {
    console.error('❌ WALLET WebSocket error:', err);
  };

  tokenWs.onerror = (err) => {
    console.error('❌ TOKEN WebSocket error:', err);
  };
}

// EXPORTED FUNCTIONS FOR OTHER FILES

// Function to start monitoring
export function startBullXMonitoring() {
  if (isMonitoring) {
    console.log('🔄 BullX monitoring already running');
    return;
  }
  
  console.log('🚀 Starting BullX KOL monitoring...');
  isMonitoring = true;
  createWebSocketConnections();
}

// Function to get all KOL tokens
export function getKolTokens() {
  return Array.from(kolTokensData.values());
}

// Function to get specific token data
export function getTokenData(contractAddress) {
  return kolTokensData.get(contractAddress) || null;
}

// Function to get monitoring status
export function isMonitoringActive() {
  return isMonitoring && 
         walletWs && walletWs.readyState === WebSocket.OPEN && 
         tokenWs && tokenWs.readyState === WebSocket.OPEN;
}

// Function to stop monitoring
export function stopBullXMonitoring() {
  console.log('🛑 Stopping BullX monitoring...');
  isMonitoring = false;
  
  if (walletWs) {
    walletWs.close();
    walletWs = null;
  }
  
  if (tokenWs) {
    tokenWs.close();
    tokenWs = null;
  }
}

// Export KOL names for reference
export { KOL_NAMES };