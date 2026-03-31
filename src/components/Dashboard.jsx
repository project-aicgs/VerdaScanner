import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import setupPumpWebSocket from "../utils/wsClient";
import TokenModal from "../components/TokenModal";
import ToastNotification from "../components/ToastNotification";
import KolFilter from "../components/KolFilter";
import Leaderboard from "../components/Leaderboard";
import SessionStats from "../components/SessionStats";
import ImageLightbox from "../components/ImageLightbox";
import KolTxSidebar from "../components/KolTxSidebar";
import { formatMarketCap, formatVolume, TOKEN_IMAGE_FALLBACK } from "../utils/formatUtils";
import { addToken, updateMarketCap } from "../utils/leaderboardStore";
import { tokenContentAllowed } from "../utils/contentFilter";
import { getOrCreateSessionStart } from "../utils/sessionBoundary";
import * as BullX from "../test-bullx-stream";
import { ALL_KOL_NAMES } from "../constants/kolWallets.js";
import { recordWhaleActivity } from "../utils/whaleActivityStore";
import { registerPumpTokenTradeSubscriber } from "../utils/pumpWsBridge";

const MAX_SUPPLY = 1_000_000_000;

/** Merge Pump + BullX data so KOL sidebar opens the same TokenModal as Verda Scanner tiles. */
function buildTokenForModalFromKolRow(row, pumpTokens, kolTokens) {
  const fromPump = pumpTokens.find((t) => t.mint === row.mint);
  const fromKol = kolTokens.find((t) => t.mint === row.mint);
  return {
    ...(fromPump || {}),
    ...(fromKol || {}),
    mint: row.mint,
    name: row.name || fromPump?.name || fromKol?.name || "Unnamed",
    symbol: row.symbol || fromPump?.symbol || fromKol?.symbol || "???",
    image: fromPump?.image || fromKol?.image || "",
    description: fromPump?.description ?? fromKol?.description ?? "",
    website: fromPump?.website ?? fromKol?.website ?? "",
    twitter: fromPump?.twitter ?? fromKol?.twitter ?? "",
    devPercent: fromPump?.devPercent ?? fromKol?.devPercent,
    initialBuy: fromPump?.initialBuy ?? fromKol?.initialBuy,
    volumeUSD: fromPump?.volumeUSD ?? fromKol?.volumeUSD,
    wasSuccessfullyLaunched: fromPump?.wasSuccessfullyLaunched ?? false,
    ownershipPercentage: row.ownershipPercentage,
    buyMarketCapUSD: row.buyMarketCapUSD ?? fromKol?.buyMarketCapUSD,
    usdSpent: row.usdSpent ?? fromKol?.usdSpent,
    tokensPurchased: row.tokensPurchased ?? fromKol?.tokensPurchased,
    kols:
      fromKol?.kols?.length > 0
        ? [...fromKol.kols]
        : row.kolName
          ? [row.kolName]
          : [],
    marketCapSol: fromPump?.marketCapSol ?? null,
    vSolInBondingCurve: fromPump?.vSolInBondingCurve ?? null,
    vTokensInBondingCurve: fromPump?.vTokensInBondingCurve ?? null,
  };
}

/** Browsers cannot fetch `ipfs://…`; use an HTTP gateway. */
function normalizeIpfsUri(uri) {
  if (!uri || typeof uri !== "string") return uri;
  const s = uri.trim();
  if (s.startsWith("ipfs://")) {
    const path = s.slice("ipfs://".length).replace(/^ipfs\//, "");
    return `https://ipfs.io/ipfs/${path}`;
  }
  return s;
}

/** Route known metadata hosts through same-origin proxy (Vite + Netlify) to avoid CORS. */
const METADATA_PROXY_PREFIX = {
  "metadata.j7tracker.com": "/__md-j7",
  "metadata.rapidlaunch.io": "/__md-rapidlaunch",
  "drilled.live": "/__md-drilled",
};

function metadataFetchUrl(uri) {
  const normalized = normalizeIpfsUri(uri);
  if (!normalized?.startsWith("http")) return normalized;
  try {
    const u = new URL(normalized);
    const prefix = METADATA_PROXY_PREFIX[u.hostname];
    if (prefix) return `${prefix}${u.pathname}${u.search}`;
  } catch {
    /* ignore */
  }
  return normalized;
}

// Function to fix IPFS URLs (images, etc.)
function fixIpfsUrl(url) {
  const u = normalizeIpfsUri(url);
  if (!u || !u.includes("ipfs/")) return u;

  const ipfsHash = u.split("ipfs/")[1];
  return `https://ipfs.io/ipfs/${ipfsHash}`;
}

// Shared filter logic - EXTRACTED so both dashboard and leaderboard use the same logic
function shouldShowPumpFunToken(token) {
  const volume = token.volumeUSD || 0;
  const dev = token.devPercent || 0;
  const marketCap = token.marketCapUSD || 0;
  
  // console.log(`🔍 [DEBUG] Checking token qualification:`, {
  //   symbol: token.symbol,
  //   volume,
  //   dev,
  //   marketCap
  // });
  
  // Must have volume > 0 first
  if (volume <= 0) {
    // console.log(`❌ Rejected: No volume (${volume})`);
    return false;
  }
  
  // Must have market cap >= 7k to be called (RESTORED ORIGINAL)
  if (marketCap < 7000) {
    // console.log(`❌ Rejected: Market cap too low (${marketCap}) - minimum $7,000`);
    return false;
  }
  
  // RESTORED ORIGINAL STRICT FILTER LOGIC
  const qualifies = (volume >= 12500 && dev <= 15) || (volume >= 7500 && dev <= 7);
  
  // console.log(`${qualifies ? '✅' : '❌'} Filter result: volume=${volume}, dev=${dev}, qualifies=${qualifies}`);
  
  return qualifies;
}

export default function Dashboard() {
  const [tokens, setTokens] = useState([]);
  const [kolTokens, setKolTokens] = useState([]);
  const [modalToken, setModalToken] = useState(null);
  const [solPrice, setSolPrice] = useState(null);
  const [toast, setToast] = useState("");
  const [excludedKols, setExcludedKols] = useState([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showKolFilter, setShowKolFilter] = useState(false);
  const [showSessionStats, setShowSessionStats] = useState(false);
  const [zoomImage, setZoomImage] = useState(null);
  const [kolTxLines, setKolTxLines] = useState([]);
  const pumpWsRef = useRef(null);
  // Must not use `new Date()` per mount — Strict Mode remount would move this forward while the leaderboard Map keeps older tokens (see sessionBoundary.js).
  const [sessionStartTime] = useState(() => getOrCreateSessionStart());

  useEffect(() => {
    const useNetlifyProxy = import.meta.env.VITE_COINGECKO_USE_NETLIFY_PROXY === "true";
    const demoKey = import.meta.env.VITE_COINGECKO_DEMO_API_KEY?.trim?.();
    const demoPath = encodeURIComponent(
      "/api/v3/simple/price?ids=solana&vs_currencies=usd"
    );
    const solUsdUrl = useNetlifyProxy
      ? `${window.location.origin}/.netlify/functions/coingecko-proxy?kind=demo&p=${demoPath}`
      : import.meta.env.DEV && demoKey
        ? `${window.location.origin}/coingecko-demo-api/api/v3/simple/price?ids=solana&vs_currencies=usd`
        : "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
    fetch(solUsdUrl)
      .then((res) => res.json())
      .then((data) => setSolPrice(data.solana.usd))
      .catch(() => {});
  }, []);

  // BullX: push KOL list on WS updates so modal MC + chart last-candle track swaps (polling alone lagged vs Pump WS).
  useEffect(() => {
    BullX.startBullXMonitoring();

    setKolTokens(BullX.getKolTokens());

    const unsub = BullX.subscribeKolTokens((snapshot) => {
      setKolTokens(snapshot);
    });

    const backupPoll = setInterval(() => {
      setKolTokens(BullX.getKolTokens());
    }, 12000);

    const debugInterval = setInterval(() => {
      // debugStore();
    }, 10000);

    return () => {
      unsub();
      clearInterval(backupPoll);
      clearInterval(debugInterval);
    };
  }, []);

  useEffect(() => {
    setKolTxLines(BullX.getKolTransactions());
    const unsub = BullX.subscribeKolTransactions((snapshot) => {
      setKolTxLines(snapshot);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!solPrice) return;

    const ws = setupPumpWebSocket(
      async (token) => {
        let metadata = {};
        try {
          const res = await fetch(metadataFetchUrl(token.uri));
          if (res.ok) metadata = await res.json();
        } catch {
          /* missing metadata, CORS without proxy, or bad JSON */
        }

        const newToken = {
          mint: token.mint,
          name: token.name || "Unnamed",
          symbol: token.symbol || "???",
          uri: token.uri,
          image: fixIpfsUrl(metadata.image) || "",
          description: metadata.description || "",
          website: metadata.website || "",
          twitter: metadata.twitter || "",
          devPublicKey: token.traderPublicKey,
          initialBuy: token.initialBuy,
          devPercent: (token.initialBuy / MAX_SUPPLY) * 100,
          volumeUSD: 0,
          marketCapUSD: 0,
          marketCapSol: token.marketCapSol != null ? Number(token.marketCapSol) : null,
          vSolInBondingCurve: token.vSolInBondingCurve != null ? Number(token.vSolInBondingCurve) : null,
          vTokensInBondingCurve: token.vTokensInBondingCurve != null ? Number(token.vTokensInBondingCurve) : null,
          wasSuccessfullyLaunched: false,  // Track if token has been "called"
        };

        // Add to tokens array
        setTokens(prev => [newToken, ...prev]);
      },
      (trade) => {
        if (
          trade.volumeUSD >= 500 &&
          (trade.txType === "buy" || trade.txType === "sell")
        ) {
          recordWhaleActivity(trade.mint, {
            side: trade.txType,
            volumeUSD: trade.volumeUSD,
            source: "pump",
          });
        }
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
              ...(trade.marketCapSol != null
                ? { marketCapSol: trade.marketCapSol }
                : {}),
              ...(trade.vSolInBondingCurve != null
                ? { vSolInBondingCurve: trade.vSolInBondingCurve }
                : {}),
              ...(trade.vTokensInBondingCurve != null
                ? { vTokensInBondingCurve: trade.vTokensInBondingCurve }
                : {}),
            };
      
            // First time qualification check (content filter must pass for leaderboard + dashboard)
            if (
              !t.wasSuccessfullyLaunched &&
              shouldShowPumpFunToken(updatedToken) &&
              tokenContentAllowed(updatedToken.symbol, updatedToken.name)
            ) {
              // console.log(`🚀 [DEBUG] Token qualifies for leaderboard:`, {
              //   symbol: updatedToken.symbol,
              //   volume: updatedToken.volumeUSD,
              //   marketCap: trade.marketCapUSD,
              //   devPercent: updatedToken.devPercent
              // });
              
              updatedToken.wasSuccessfullyLaunched = true;
              
              // Pass volume data for validation
              addToken({
                contractAddress: t.mint,
                symbol: updatedToken.symbol,
                name: updatedToken.name,
                image: updatedToken.image,
                description: updatedToken.description,
                marketCapUSD: trade.marketCapUSD,
                volumeUSD: trade.volumeUSD, // Include current trade volume
                devPercent: updatedToken.devPercent,
                initialMarketCap: trade.marketCapUSD,
                peakMarketCap: trade.marketCapUSD,
                currentMarketCap: trade.marketCapUSD
              }, 'pumpfun');
            } else if (!t.wasSuccessfullyLaunched) {
              // console.log(`🔍 [DEBUG] Token doesn't qualify yet:`, {
              //   symbol: updatedToken.symbol,
              //   volume: updatedToken.volumeUSD,
              //   marketCap: trade.marketCapUSD,
              //   devPercent: updatedToken.devPercent,
              //   meetsVolume: updatedToken.volumeUSD > 0,
              //   meetsMarketCap: trade.marketCapUSD >= 7000,
              //   meetsFilter: shouldShowPumpFunToken(updatedToken)
              // });
            }
      
            // Update market cap for all subsequent trades (if token was already launched)
            if (t.wasSuccessfullyLaunched) {
              // Pass volume data to updateMarketCap
              updateMarketCap(t.mint, trade.marketCapUSD, trade.volumeUSD);
            }
      
            return updatedToken;
          })
        );
      },
      async (kolTx) => {
        // Keep this empty function to maintain parameter order
      },
      solPrice
    );

    pumpWsRef.current = ws;
    registerPumpTokenTradeSubscriber((mint) => {
      const w = pumpWsRef.current;
      if (w?.readyState === WebSocket.OPEN) {
        w.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
      }
    });

    return () => {
      pumpWsRef.current = null;
      registerPumpTokenTradeSubscriber(null);
      ws.close();
    };
  }, [solPrice]);

  const openModal = (token) => {
    setModalToken(token);
  };

  const openModalFromKolRow = (row) => {
    setModalToken(buildTokenForModalFromKolRow(row, tokens, kolTokens));
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

  // Apply PumpFun filters - show only launched tokens with allowed symbol/name
  const filteredTokens = tokens.filter(
    (token) =>
      token.wasSuccessfullyLaunched &&
      tokenContentAllowed(token.symbol, token.name)
  );

  const filteredMintSnapshotRef = useRef(null);
  const [flashMintTick, setFlashMintTick] = useState({});

  useEffect(() => {
    const current = new Set(filteredTokens.map((t) => t.mint));
    if (filteredMintSnapshotRef.current === null) {
      filteredMintSnapshotRef.current = current;
      return;
    }
    const prev = filteredMintSnapshotRef.current;
    for (const m of current) {
      if (!prev.has(m)) {
        setFlashMintTick((f) => ({ ...f, [m]: Date.now() }));
        window.setTimeout(() => {
          setFlashMintTick((f) => {
            const next = { ...f };
            delete next[m];
            return next;
          });
        }, 900);
      }
    }
    filteredMintSnapshotRef.current = current;
  }, [filteredTokens]);

  /**
   * Bonding / PumpSwap window: chart polls ~10s with forced pool refresh; refresh BullX + pump row
   * so modal MC/price stay aligned with Gecko.
   */
  const handleChartMigrationSync = useCallback(() => {
    const mint = modalToken?.mint;
    setKolTokens(BullX.getKolTokens());
    if (!mint) return;
    const row = BullX.getTokenData(mint);
    if (!row) return;
    setTokens((prev) => {
      const i = prev.findIndex((t) => t.mint === mint);
      if (i === -1) return prev;
      const cur = prev[i];
      const merged = {
        ...cur,
        marketCapUSD: row.marketCapUSD ?? cur.marketCapUSD,
        priceUSD: row.priceUSD ?? cur.priceUSD,
        supply: row.supply ?? cur.supply,
        website: row.website ?? cur.website,
        twitter: row.twitter ?? cur.twitter,
        image: row.image || cur.image,
        description: row.description ?? cur.description,
      };
      if (
        merged.marketCapUSD === cur.marketCapUSD &&
        merged.priceUSD === cur.priceUSD &&
        merged.supply === cur.supply
      ) {
        return prev;
      }
      const next = [...prev];
      next[i] = merged;
      return next;
    });
  }, [modalToken?.mint]);

  /** Modal was opened with a snapshot; merge stream updates so MC/price/chart stay live. */
  const modalTokenLive = useMemo(() => {
    if (!modalToken?.mint) return null;
    const fromPump = tokens.find((t) => t.mint === modalToken.mint);
    const fromKol = kolTokens.find((t) => t.mint === modalToken.mint);
    const live = fromPump || fromKol;
    if (!live) return modalToken;
    return {
      ...modalToken,
      marketCapUSD: live.marketCapUSD ?? modalToken.marketCapUSD,
      buyMarketCapUSD: live.buyMarketCapUSD ?? modalToken.buyMarketCapUSD,
      volumeUSD: live.volumeUSD ?? modalToken.volumeUSD,
      priceUSD: live.priceUSD ?? modalToken.priceUSD,
      supply: live.supply ?? modalToken.supply,
      devPercent: live.devPercent ?? modalToken.devPercent,
      initialBuy: live.initialBuy ?? modalToken.initialBuy,
      ownershipPercentage: live.ownershipPercentage ?? modalToken.ownershipPercentage,
      usdSpent: live.usdSpent ?? modalToken.usdSpent,
      tokensPurchased: live.tokensPurchased ?? modalToken.tokensPurchased,
      kols: live.kols ?? modalToken.kols,
      wasSuccessfullyLaunched: live.wasSuccessfullyLaunched ?? modalToken.wasSuccessfullyLaunched,
      marketCapSol: live.marketCapSol ?? modalToken.marketCapSol,
      vSolInBondingCurve: live.vSolInBondingCurve ?? modalToken.vSolInBondingCurve,
      vTokensInBondingCurve: live.vTokensInBondingCurve ?? modalToken.vTokensInBondingCurve,
    };
  }, [modalToken, tokens, kolTokens]);

  /** Per-buy rows for the open mint (sidebar log), newest first — shown inside TokenModal. */
  const kolBuyBreakdown = useMemo(() => {
    if (!modalToken?.mint) return [];
    const rows = kolTxLines
      .filter((r) => r.mint === modalToken.mint)
      .map((r) => ({
        id: r.id,
        kolName: r.kolName,
        usdSpent: r.usdSpent,
        tokensPurchased: r.tokensPurchased,
        buyMarketCapUSD: r.buyMarketCapUSD,
        ownershipPercentage: r.ownershipPercentage,
        ts: r.ts,
      }));
    rows.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    return rows;
  }, [modalToken?.mint, kolTxLines]);

  return (
    <>
      {toast && <ToastNotification key={toast} message={toast} />}

      <div className="dashboard-shell">
        <div className="dashboard-main-column">
          {/* New Header with Logo and Controls */}
          <div className="app-header">
            <div className="logo-container">
              <img src="/verdalogo.png" alt="Verda" className="logo" />
              <div className="brand-name">Verda</div>
            </div>

            <div className="header-controls">
              <button
                className="header-btn"
                onClick={() => setShowKolFilter(!showKolFilter)}
              >
                {`Smart Wallet Filter (${ALL_KOL_NAMES.length - excludedKols.length}/${ALL_KOL_NAMES.length})`}
              </button>
              <button
                className="header-btn"
                onClick={() => setShowSessionStats(true)}
              >
                Win Rate
              </button>
              <button
                className="header-btn"
                onClick={() => setShowLeaderboard(true)}
              >
                Leaderboard
              </button>
            </div>
          </div>

          {/* KOL Filter Dropdown */}
          {showKolFilter && (
            <div style={{ position: "relative", zIndex: 1000 }}>
              <KolFilter
                excludedKols={excludedKols}
                onKolToggle={handleKolToggle}
                onClose={() => setShowKolFilter(false)}
              />
            </div>
          )}

          <h2 className="section-label">Verda Scanner</h2>
      <div className="tile-container">
        {filteredTokens.length === 0 ? (
          <div
            className="token-tile token-tile--empty-state"
            role="status"
            aria-live="polite"
          >
            <div className="token-tile-empty-message">Awaiting new token mints...</div>
          </div>
        ) : (
          filteredTokens.map(t => (
            <div
              className={`token-tile${flashMintTick[t.mint] ? " token-tile--flash-new" : ""}`}
              key={t.mint}
              onClick={() => openModal(t)}
            >
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
              <button
                type="button"
                className="token-tile-media"
                aria-label={`Enlarge ${t.symbol || "token"} image`}
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomImage({
                    src: t.image || TOKEN_IMAGE_FALLBACK,
                    alt: t.symbol || "Token",
                  });
                }}
              >
                <img
                  src={t.image || TOKEN_IMAGE_FALLBACK}
                  alt=""
                  className="token-image-hero"
                  onError={(e) => {
                    const el = e.currentTarget;
                    el.onerror = null;
                    if (el.dataset.fallbackApplied) return;
                    el.dataset.fallbackApplied = "1";
                    el.src = TOKEN_IMAGE_FALLBACK;
                  }}
                />
              </button>
              <div className="token-tile-head token-tile-head--stacked">
                <div className="token-tile-titles">
                  <div className="symbol">{t.symbol}</div>
                  <div className="name">{t.name}</div>
                </div>
              </div>
              <div className="socials">
                {t.website && (
                  <a 
                    href={t.website.startsWith('http') ? t.website : `https://${t.website}`} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="social-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Website
                  </a>
                )}
                {t.twitter && (
                  <a 
                    href={t.twitter.startsWith('http') ? t.twitter : `https://x.com/${t.twitter.replace('@', '')}`} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="social-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    X / Twitter
                  </a>
                )}
              </div>
              <div className="token-tile-metrics">
                <div className="token-metric token-metric--span">
                  <span className="token-metric-label">Dev holdings</span>
                  <span className="token-metric-value">{t.devPercent.toFixed(2)}%</span>
                </div>
                <div className="token-metric">
                  <span className="token-metric-label">Volume</span>
                  <span className="token-metric-value">{formatVolume(t.volumeUSD)}</span>
                </div>
                <div className="token-metric">
                  <span className="token-metric-label">Market cap</span>
                  <span className="token-metric-value">{formatMarketCap(t.marketCapUSD)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
        </div>

        <KolTxSidebar
          lines={kolTxLines}
          excludedKols={excludedKols}
          onLineClick={openModalFromKolRow}
        />
      </div>

      {modalTokenLive && (
        <TokenModal
          token={modalTokenLive}
          kolBuyBreakdown={kolBuyBreakdown}
          onChartMigrationSync={handleChartMigrationSync}
          onClose={() => setModalToken(null)}
          onCopy={(addr) => {
            navigator.clipboard.writeText(addr);
            setToast("Contract Address Successfully Copied");
            setTimeout(() => setToast(""), 2500);
          }}
        />
      )}

      {showLeaderboard && (
        <Leaderboard 
          onClose={() => setShowLeaderboard(false)}
        />
      )}

      {showSessionStats && (
        <SessionStats 
          onClose={() => setShowSessionStats(false)}
          sessionStartTime={sessionStartTime}
        />
      )}

      {zoomImage && (
        <ImageLightbox
          src={zoomImage.src}
          alt={zoomImage.alt}
          onClose={() => setZoomImage(null)}
        />
      )}
    </>
  );
}