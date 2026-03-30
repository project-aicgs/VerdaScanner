import React, { useEffect, useMemo, useState } from "react";
import { useWhaleEvents } from "../hooks/useWhaleEvents";
import { subscribeMintTokenTrades } from "../utils/pumpWsBridge";
import {
  formatMarketCap,
  formatVolume,
  formatTokenPrice,
  formatTokenAmount,
  TOKEN_IMAGE_FALLBACK,
} from "../utils/formatUtils";
import "./ModalStyles.css";
import ImageLightbox from "./ImageLightbox";
import TokenPriceChart from "./TokenPriceChart";

function formatUtcClock() {
  return new Date().toISOString().slice(11, 19);
}

function truncateMint(mint) {
  if (!mint || mint.length < 14) return mint || "—";
  return `${mint.slice(0, 6)}…${mint.slice(-4)}`;
}

/** Aligns with pump.fun-style MC display when the stream has no explicit `priceUSD`. */
const PUMP_FUN_UI_SUPPLY = 1_000_000_000;

/** Renders under Links in the aside (volume, dev holdings — MC stays in hero/main). */
const ASIDE_PRIMARY_METRIC_KEYS = new Set(["vol", "dev"]);

function formatWhaleTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

function formatKolBuyTime(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatBuyOwnershipPct(pct) {
  if (pct == null || !Number.isFinite(pct)) return "—";
  if (pct > 0 && pct < 0.01) return "<0.01%";
  return `${pct.toFixed(2)}%`;
}

function scannerLivePriceUsd(t) {
  if (!t) return null;
  const { priceUSD, marketCapUSD, supply } = t;
  if (priceUSD != null && Number.isFinite(priceUSD) && priceUSD > 0) return priceUSD;
  const s =
    supply != null && Number.isFinite(supply) && supply > 0
      ? supply
      : PUMP_FUN_UI_SUPPLY;
  if (marketCapUSD != null && Number.isFinite(marketCapUSD) && marketCapUSD > 0)
    return marketCapUSD / s;
  return null;
}

export default function TokenModal({ token, onClose, onCopy, kolBuyBreakdown = [] }) {
  const [utcTime, setUtcTime] = useState(formatUtcClock);
  const [zoomImage, setZoomImage] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setUtcTime(formatUtcClock()), 1000);
    return () => clearInterval(id);
  }, []);

  const volumeCard = useMemo(() => {
    if (!token) return null;
    const { volumeUSD, usdSpent } = token;
    if (volumeUSD != null && Number.isFinite(volumeUSD) && volumeUSD > 0) {
      return { label: "Volume", value: formatVolume(volumeUSD) };
    }
    if (usdSpent != null && Number.isFinite(usdSpent) && usdSpent > 0) {
      return { label: "Smart wallet buy (USD)", value: formatVolume(usdSpent) };
    }
    return null;
  }, [token]);

  const metricCards = useMemo(() => {
    if (!token) return [];
    const {
      marketCapUSD,
      devPercent,
      ownershipPercentage,
      supply,
      tokensPurchased,
    } = token;
    const rows = [];
    if (volumeCard) {
      rows.push({
        key: "vol",
        label: volumeCard.label,
        value: volumeCard.value,
        tone: "positive",
      });
    }
    if (devPercent !== undefined && devPercent !== null && Number.isFinite(devPercent)) {
      rows.push({
        key: "dev",
        label: "Dev holdings",
        value: `${devPercent.toFixed(2)}%`,
        tone: devPercent > 12 ? "warn" : "neutral",
      });
    }
    if (
      ownershipPercentage != null &&
      Number.isFinite(ownershipPercentage) &&
      ownershipPercentage > 0
    ) {
      rows.push({
        key: "kolown",
        label: "Est. smart wallet ownership",
        value: `${ownershipPercentage.toFixed(4)}%`,
        tone: "neutral",
      });
    }
    const supplyStr = formatTokenAmount(supply);
    if (supplyStr) {
      rows.push({
        key: "supply",
        label: "Reported supply",
        value: supplyStr,
        tone: "neutral",
      });
    }
    const boughtStr = formatTokenAmount(tokensPurchased);
    if (boughtStr && tokensPurchased > 0) {
      rows.push({
        key: "bought",
        label: "Smart wallet tokens (est.)",
        value: boughtStr,
        tone: "neutral",
      });
    }
    return rows;
  }, [token, volumeCard]);

  const asideMetricCards = useMemo(
    () => metricCards.filter((m) => ASIDE_PRIMARY_METRIC_KEYS.has(m.key)),
    [metricCards]
  );
  const mainMetricCards = useMemo(
    () => metricCards.filter((m) => !ASIDE_PRIMARY_METRIC_KEYS.has(m.key)),
    [metricCards]
  );

  const whaleEvents = useWhaleEvents(token?.mint);

  useEffect(() => {
    if (token?.mint) subscribeMintTokenTrades(token.mint);
  }, [token?.mint]);

  if (!token) return null;

  const {
    mint,
    name,
    symbol,
    description,
    image,
    kols = [],
    website,
    twitter,
    priceUSD,
    marketCapUSD,
  } = token;

  const priceStr = formatTokenPrice(priceUSD);
  const sym = symbol || "???";

  const hasAside = true;

  const pairLabel = priceStr ? `${sym} / USD` : `${sym} · Solana`;

  return (
    <>
    <div className="vtd-overlay" onClick={onClose} role="presentation">
      <div
        className="vtd-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vtd-token-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="vtd-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>

        <header className="vtd-header">
          <div className="vtd-brand">
            <button
              type="button"
              className="vtd-brand-zoom"
              aria-label={`Enlarge ${sym} image`}
              onClick={() =>
                setZoomImage({ src: image || TOKEN_IMAGE_FALLBACK, alt: sym })
              }
            >
              <img
                src={image || TOKEN_IMAGE_FALLBACK}
                alt=""
                className="vtd-brand-icon"
                onError={(e) => {
                  const el = e.currentTarget;
                  el.onerror = null;
                  if (el.dataset.fallbackApplied) return;
                  el.dataset.fallbackApplied = "1";
                  el.src = TOKEN_IMAGE_FALLBACK;
                }}
              />
            </button>
            <div className="vtd-brand-text">
              <h1 id="vtd-token-title" className="vtd-title">
                {name || "Unnamed token"}
              </h1>
              <p className="vtd-subtitle">
                {sym} · Scanner metrics
              </p>
            </div>
          </div>
          <div className="vtd-header-meta">
            <span className="vtd-live-pill">
              <span className="vtd-live-dot" aria-hidden />
              Live
            </span>
            <span className="vtd-utc">{utcTime} UTC</span>
          </div>
        </header>

        <div className={`vtd-body ${hasAside ? "vtd-body--aside" : ""}`}>
          <div className="vtd-main">
            <section className="vtd-hero-card" aria-label="Primary metric">
              <p className="vtd-hero-label">{pairLabel}</p>
              {priceStr ? (
                <p className="vtd-hero-value">{priceStr}</p>
              ) : marketCapUSD != null &&
                Number.isFinite(marketCapUSD) &&
                marketCapUSD > 0 ? (
                <>
                  <p className="vtd-hero-value">{formatMarketCap(marketCapUSD)}</p>
                  <p className="vtd-hero-caption">Market cap</p>
                </>
              ) : (
                <p className="vtd-hero-value vtd-hero-value--muted">—</p>
              )}
            </section>

            <TokenPriceChart
              mint={mint}
              livePriceUsd={scannerLivePriceUsd(token)}
              marketCapSol={token.marketCapSol ?? null}
            />

            {kolBuyBreakdown.length > 0 && (
              <section className="vtd-kol-buys" aria-label="Smart wallet buys for this token">
                <h2 className="vtd-section-heading">Smart wallet buys</h2>
                <p className="vtd-kol-buys-sub">
                  Amount spent, estimated tokens, % of supply added, and market cap at each tracked buy.
                </p>
                <div className="vtd-kol-buys-scroll">
                  <div className="vtd-kol-buys-head" aria-hidden>
                    <span>Smart wallet</span>
                    <span>Buy (USD)</span>
                    <span>Tokens (est.)</span>
                    <span>% supply</span>
                    <span>MC at buy</span>
                    <span>Time</span>
                  </div>
                  <ul className="vtd-kol-buys-list">
                    {kolBuyBreakdown.map((b) => (
                      <li key={b.id} className="vtd-kol-buys-row">
                        <span className="vtd-kol-buys-cell vtd-kol-buys-kol">
                          {b.kolName}
                        </span>
                        <span className="vtd-kol-buys-cell">
                          {formatVolume(b.usdSpent)}
                        </span>
                        <span className="vtd-kol-buys-cell">
                          {b.tokensPurchased != null &&
                          Number.isFinite(b.tokensPurchased) &&
                          b.tokensPurchased > 0
                            ? formatTokenAmount(b.tokensPurchased)
                            : "—"}
                        </span>
                        <span className="vtd-kol-buys-cell vtd-kol-buys-pct">
                          {formatBuyOwnershipPct(b.ownershipPercentage)}
                        </span>
                        <span className="vtd-kol-buys-cell vtd-kol-buys-mc">
                          {b.buyMarketCapUSD != null &&
                          Number.isFinite(b.buyMarketCapUSD) &&
                          b.buyMarketCapUSD > 0
                            ? formatMarketCap(b.buyMarketCapUSD)
                            : "—"}
                        </span>
                        <span className="vtd-kol-buys-cell vtd-kol-buys-time">
                          {formatKolBuyTime(b.ts)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {mainMetricCards.length > 0 && (
              <section className="vtd-metrics" aria-label="Token metrics">
                {mainMetricCards.map((m) => (
                  <div
                    key={m.key}
                    className={`vtd-metric vtd-metric--${m.tone}`}
                  >
                    <span className="vtd-metric-label">{m.label}</span>
                    <span className="vtd-metric-value">{m.value}</span>
                  </div>
                ))}
              </section>
            )}

            {description && String(description).trim() && (
              <section className="vtd-about">
                <h2 className="vtd-section-heading">About</h2>
                <p className="vtd-about-text">{description}</p>
              </section>
            )}
          </div>

          {hasAside && (
            <aside className="vtd-aside">
              {kols.length > 0 && (
                <div className="vtd-panel">
                  <h2 className="vtd-panel-title">Smart wallet activity</h2>
                  <ul className="vtd-list">
                    {kols.map((k) => (
                      <li key={k} className="vtd-list-item vtd-list-item--accent">
                        <span className="vtd-list-dot" aria-hidden />
                        <span className="vtd-list-main">{k}</span>
                        <span className="vtd-list-meta">tracked</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(website || twitter) && (
                <div className="vtd-panel">
                  <h2 className="vtd-panel-title">Links</h2>
                  <ul className="vtd-link-list">
                    {website && String(website).trim() && (
                      <li>
                        <a
                          href={
                            website.startsWith("http")
                              ? website
                              : `https://${website}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="vtd-link"
                        >
                          Website
                        </a>
                      </li>
                    )}
                    {twitter && String(twitter).trim() && (
                      <li>
                        <a
                          href={
                            twitter.startsWith("http")
                              ? twitter
                              : `https://x.com/${twitter.replace("@", "")}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="vtd-link"
                        >
                          X / Twitter
                        </a>
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {asideMetricCards.length > 0 && (
                <div
                  className="vtd-panel vtd-panel--aside-primary-metrics"
                  aria-label="Volume and dev holdings"
                >
                  {asideMetricCards.map((m) => (
                    <div
                      key={m.key}
                      className={`vtd-aside-metric-row vtd-metric--${m.tone}`}
                    >
                      <span className="vtd-aside-metric-label">{m.label}</span>
                      <span className="vtd-aside-metric-value">{m.value}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="vtd-panel vtd-panel--whale">
                <h2 className="vtd-panel-title">Recent Whale Activity</h2>
                <div className="vtd-whale-feed" role="log" aria-live="polite">
                  {whaleEvents.length === 0 ? (
                    <p className="vtd-whale-empty">
                      No buys or sells ≥ $500 yet for this mint.
                    </p>
                  ) : (
                    whaleEvents.map((e) => (
                      <div
                        key={e.id}
                        className={`vtd-whale-line vtd-whale-line--${e.side}`}
                      >
                        <span className="vtd-whale-side">
                          {e.side === "buy" ? "Buy" : "Sell"}
                        </span>
                        <span className="vtd-whale-amt">
                          {formatVolume(e.usd)}
                        </span>
                        <span className="vtd-whale-time">{formatWhaleTime(e.ts)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </aside>
          )}
        </div>

        <footer className="vtd-footer">
          <button
            type="button"
            className="vtd-footer-contract"
            onClick={() => onCopy(mint)}
            title="Copy full contract address"
          >
            Contract {truncateMint(mint)}
          </button>
          <span className="vtd-footer-center">Verda scanner</span>
          <span className="vtd-footer-network">Network · Solana</span>
        </footer>
      </div>
    </div>
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
