import React, { useEffect, useState } from "react";
import setupPumpWebSocket from "../utils/wsClient";
import TokenModal from "../components/TokenModal";
import ToastNotification from "../components/ToastNotification";
import KolFilter from "../components/KolFilter";
import Leaderboard from "../components/Leaderboard";
import { formatMarketCap, formatVolume } from "../utils/formatUtils";
import { addToken, debugStore } from "../utils/leaderboardStore";
import * as BullX from "../test-bullx-stream";

const MAX_SUPPLY = 1_000_000_000;

// Function to fix IPFS URLs
function fixIpfsUrl(url) {
  if (!url || !url.includes('ipfs/')) return url;
  
  const ipfsHash = url.split('ipfs/')[1];
  return `https://ipfs.io/ipfs/${ipfsHash}`;
}

// Shared filter logic - EXTRACTED so both dashboard and leaderboard use the same logic
function shouldShowPumpFunToken(token) {
  const volume = token.volumeUSD || 0;
  const dev = token.devPercent || 0;
  
  // Must have volume > 0 first
  if (volume <= 0) return false;
  
  // Then apply the complex filter logic
  return (volume >= 12500 && dev <= 15) || (volume >= 7500 && dev <= 7);
}

function shouldShowKolToken(token, excludedKols = []) {
  // First filter: excluded KOLs
  if (excludedKols.some(excludedKol => token.kols && token.kols.includes(excludedKol))) {
    return false;
  }
  
  // Second filter: ignore if KOL bought 10% or more
  if (token.ownershipPercentage >= 10) {
    return false;
  }
  
  return true;
}

export default function Dashboard() {
  const [tokens, setTokens] = useState([]);
  const [kolTokens, setKolTokens] = useState([]);
  const [modalToken, setModalToken] = useState(null);
  const [solPrice, setSolPrice] = useState(null);
  const [toast, setToast] = useState("");
  const [excludedKols, setExcludedKols] = useState([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")
      .then(res => res.json())
      .then(data => setSolPrice(data.solana.usd))
      .catch(console.error);
  }, []);

  // Start BullX monitoring and poll for KOL tokens
  useEffect(() => {
    BullX.startBullXMonitoring();
    
    const pollKolTokens = () => {
      const bullxKolTokens = BullX.getKolTokens();
      setKolTokens(bullxKolTokens);
    };

    // Poll every 2 seconds for new KOL tokens
    const interval = setInterval(pollKolTokens, 2000);

    // Debug: Check leaderboard store every 10 seconds
    const debugInterval = setInterval(() => {
      console.log('🐛 Debug check - calling debugStore()');
      debugStore();
      
      // Also debug BullX
      if (BullX.debugBullX) {
        BullX.debugBullX();
      }
    }, 10000);

    return () => {
      clearInterval(interval);
      clearInterval(debugInterval);
    };
  }, []);

  useEffect(() => {
    if (!solPrice) return;

    const ws = setupPumpWebSocket(
      async (token) => {
        let metadata = {};
        try {
          const res = await fetch(token.uri);
          metadata = await res.json();
        } catch {}

        const newToken = {
          mint: token.mint,
          name: token.name || "Unnamed",
          symbol: token.symbol || "???",
          uri: token.uri,
          image: fixIpfsUrl(metadata.image) || "",
          description: metadata.description || "",
          devPublicKey: token.traderPublicKey,
          initialBuy: token.initialBuy,
          devPercent: (token.initialBuy / MAX_SUPPLY) * 100,
          volumeUSD: 0,
          marketCapUSD: 0,
        };

        // Add to tokens array
        setTokens(prev => [newToken, ...prev]);
      },
      (trade) => {
        setTokens(prev =>
          prev.map(t => {
            if (t.mint !== trade.mint) return t;
            const isDev = t.devPublicKey === trade.traderPublicKey;
            const newInitialBuy = isDev && trade.txType === "sell"
              ? Math.max(0, t.initialBuy - trade.tokenAmount)
              : t.initialBuy;

            const updatedToken = {
              ...t,
              initialBuy: newInitialBuy,
              devPercent: (newInitialBuy / MAX_SUPPLY) * 100,
              volumeUSD: t.volumeUSD + trade.volumeUSD,
              marketCapUSD: trade.marketCapUSD,
            };

            // NEW: Add to leaderboard store if it passes filters
            if (shouldShowPumpFunToken(updatedToken)) {
              console.log('Adding PumpFun token to leaderboard:', updatedToken.symbol);
              addToken({
                contractAddress: t.mint,
                symbol: updatedToken.symbol,
                name: updatedToken.name,
                image: updatedToken.image,
                description: updatedToken.description,
                marketCapUSD: trade.marketCapUSD,
                volumeUSD: updatedToken.volumeUSD,
                devPercent: updatedToken.devPercent,
                initialMarketCap: trade.marketCapUSD, // Use first trade as initial
                peakMarketCap: trade.marketCapUSD,
                currentMarketCap: trade.marketCapUSD
              }, 'pumpfun');
            }

            return updatedToken;
          })
        );
      },
      async (kolTx) => {
        // This is handled by BullX now, so can be empty or removed later
      },
      solPrice
    );

    return () => ws.close();
  }, [solPrice]);

  const openModal = (token) => {
    setModalToken(token);
  };

  const handleKolToggle = (kolName) => {
    setExcludedKols(prev => {
      if (prev.includes(kolName)) {
        // Remove from excluded list (show this KOL)
        return prev.filter(kol => kol !== kolName);
      } else {
        // Add to excluded list (hide this KOL)
        return [...prev, kolName];
      }
    });
  };

  const handleCopyAddress = (address, event) => {
    event.stopPropagation(); // Prevent opening modal
    navigator.clipboard.writeText(address);
    setToast("Contract Address Copied!");
    setTimeout(() => setToast(""), 2500);
    
    // Add visual feedback to copy icon
    const copyIcon = event.currentTarget;
    copyIcon.classList.add('copied');
    setTimeout(() => {
      copyIcon.classList.remove('copied');
    }, 600);
  };

  // Filter KOL tokens based on excluded KOLs AND volume/dev criteria
  const filteredKolTokens = kolTokens.filter(token => shouldShowKolToken(token, excludedKols));

  // DEDUPLICATE KOL TOKENS - Fix for React key warning
  const deduplicatedKolTokens = filteredKolTokens.reduce((acc, token) => {
    const existing = acc.find(t => t.mint === token.mint);
    if (existing) {
      // Merge KOLs if same token - combine all KOLs who bought this token
      existing.kols = [...new Set([...existing.kols, ...token.kols])];
      // Keep the highest ownership percentage and USD spent
      if (token.ownershipPercentage > existing.ownershipPercentage) {
        existing.ownershipPercentage = token.ownershipPercentage;
        existing.usdSpent = token.usdSpent;
        existing.tokensPurchased = token.tokensPurchased;
      }
    } else {
      acc.push({ ...token });
    }
    return acc;
  }, []);

  // Apply PumpFun filters
  const filteredTokens = tokens.filter(shouldShowPumpFunToken);

  return (
    <>
      {toast && <ToastNotification message={toast} />}

      <div className="controls">
        <KolFilter 
          excludedKols={excludedKols} 
          onKolToggle={handleKolToggle} 
        />
        <button 
          className="leaderboard-btn"
          onClick={() => setShowLeaderboard(true)}
        >
          🏆 Leaderboard
        </button>
      </div>

      <h2 className="section-label">📡 KOL Scanner</h2>
      <div className="tile-container">
        {deduplicatedKolTokens.map(t => (
          <div className="token-tile kol-alert" key={t.mint} onClick={() => openModal(t)}>
            <div 
              className="copy-icon" 
              onClick={(e) => handleCopyAddress(t.mint, e)}
              title="Copy contract address"
            >
              <div className="copy-squares">
                <div className="copy-square back"></div>
                <div className="copy-square front"></div>
              </div>
            </div>
            {t.image && <img 
              src={t.image} 
              alt={t.symbol} 
              className="token-image"
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />}
            <div className="symbol">{t.symbol}</div>
            <div className="name">{t.name}</div>
            <div className="kol-buyer-name">{t.kols.join(" & ")}</div>
            <div className="kol-alert-text">
              Bought {t.ownershipPercentage ? t.ownershipPercentage.toFixed(4) : '0'}% at {formatMarketCap(t.marketCapUSD)} MC!
            </div>
          </div>
        ))}
      </div>

      <h2 className="section-label">📈 All Tokens</h2>
      <div className="tile-container">
        {filteredTokens.map(t => (
          <div className="token-tile" key={t.mint} onClick={() => openModal(t)}>
            <div 
              className="copy-icon" 
              onClick={(e) => handleCopyAddress(t.mint, e)}
              title="Copy contract address"
            >
              <div className="copy-squares">
                <div className="copy-square back"></div>
                <div className="copy-square front"></div>
              </div>
            </div>
            {t.image && <img 
              src={t.image} 
              alt={t.symbol} 
              className="token-image"
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />}
            <div className="symbol">{t.symbol}</div>
            <div className="name">{t.name}</div>
            <div className="description">{t.description}</div>
            <div className="dev-percent">Dev Holdings: {t.devPercent.toFixed(2)}%</div>
            <div className="volume">Volume: {formatVolume(t.volumeUSD)}</div>
            <div className="marketcap">Market Cap: {formatMarketCap(t.marketCapUSD)}</div>
          </div>
        ))}
      </div>

      {modalToken && (
        <TokenModal token={modalToken} onClose={() => setModalToken(null)} onCopy={(addr) => {
          navigator.clipboard.writeText(addr);
          setToast("Contract Address Successfully Copied");
          setTimeout(() => setToast(""), 2500);
        }} />
      )}

      {showLeaderboard && (
        <Leaderboard 
          onClose={() => setShowLeaderboard(false)}
        />
      )}
    </>
  );
}