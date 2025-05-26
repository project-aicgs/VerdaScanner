// Browser-compatible bridge for KOL data
// This file can be imported by React components

// Shared KOL Names (extracted from test-bullx-stream.js)
export const KOL_NAMES = {
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
    "DfMxre4cKmvogbLrPigxmibVTTQDuzjdXojWzjCXXhzj": "EURIS",
    "5rkPDK4JnVAumgzeV2Zu8vjggMTtHdDtrsd5o9dhGZHD": "DAVE PORTNOY",
    "FXzJ6xwH2HfdKshERVAYiLh79PAUw9zC7ucngupt91ap": "DAVE PORTNOY",
  };
  
  // Convert to array for easier use
  export const KOL_WALLETS = Object.keys(KOL_NAMES);
  
  // Simple event system for browser
  class KOLEventEmitter {
    constructor() {
      this.events = {};
    }
  
    on(event, callback) {
      if (!this.events[event]) {
        this.events[event] = [];
      }
      this.events[event].push(callback);
    }
  
    off(event, callback) {
      if (!this.events[event]) return;
      this.events[event] = this.events[event].filter(cb => cb !== callback);
    }
  
    emit(event, data) {
      if (!this.events[event]) return;
      this.events[event].forEach(callback => callback(data));
    }
  }
  
  // Global emitter for KOL events
  export const kolEmitter = new KOLEventEmitter();
  
  // Store for KOL tokens (can be used by React components)
  export const kolTokenStore = {
    tokens: [],
    
    addOrUpdateToken(tokenData) {
      const existingIndex = this.tokens.findIndex(t => t.mint === tokenData.mint);
      if (existingIndex >= 0) {
        this.tokens[existingIndex] = { ...this.tokens[existingIndex], ...tokenData };
      } else {
        this.tokens.unshift(tokenData);
      }
      kolEmitter.emit('kolTokenUpdate', this.tokens);
    },
  
    getTokens() {
      return this.tokens;
    }
  };
  
  // Function to simulate receiving data from the BullX stream
  // This will be called by a WebSocket or polling mechanism
  export function receiveBullXData(tokenData) {
    kolTokenStore.addOrUpdateToken(tokenData);
  }
  
  // For now, we can create a WebSocket connection to your local server
  // that bridges the Node.js BullX stream to the browser
  export function connectToBullXBridge() {
    console.log('📡 Connecting to BullX bridge...');
    
    try {
      const ws = new WebSocket('ws://localhost:5173');
      
      ws.onopen = () => {
        console.log('✅ Connected to BullX bridge server');
      };
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'kolTokenUpdate') {
            kolTokenStore.addOrUpdateToken(message.data);
          }
        } catch (err) {
          console.error('Error parsing bridge message:', err);
        }
      };
      
      ws.onclose = () => {
        console.log('🔌 Disconnected from BullX bridge');
        // Auto-reconnect after 5 seconds
        setTimeout(connectToBullXBridge, 5000);
      };
      
      ws.onerror = (err) => {
        console.error('BullX bridge connection error:', err);
      };
      
    } catch (err) {
      console.error('Failed to connect to BullX bridge:', err);
      // Retry connection after 5 seconds
      setTimeout(connectToBullXBridge, 5000);
    }
    
    return kolEmitter;
  }