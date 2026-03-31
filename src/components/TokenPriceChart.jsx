import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createChart, ColorType } from "lightweight-charts";
import {
  CHART_DEBUG,
  fetchBestPoolAddress,
  fetchMinuteOhlcv,
  geckoTokenUrl,
  ohlcvBarsLookStale,
} from "../services/geckoTerminal";
import { formatChartUsdAxis } from "../utils/formatUtils";
import {
  chartPoolResolutionEpoch,
  inMigrationChartSyncWindow,
  shouldAggressivelyRefreshChartPools,
} from "../utils/pumpBonding";
import "./TokenPriceChart.css";

/** 1m bars — closer to Gecko “live” view than 5m aggregates. */
const CHART_AGGREGATE = 1;
/**
 * 200 bars = ~3.3 h of 1m candles. Enough context; smaller limit means
 * faster responses and lower server-side cost → less likely to 429.
 */
const CHART_LIMIT = 200;
/**
 * Poll interval for OHLCV refresh attempts. Live price is updated from the
 * parent via mergeLiveIntoLastBar (not this timer). geckoTerminal skips
 * network when OHLCV cache is still very fresh, so most ticks are cheap.
 */
const OHLCV_POLL_MS = 10_000;

function cloneBars(data) {
  return data.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
}

function mergeLiveIntoLastBar(series, bars, price) {
  if (price == null || !Number.isFinite(price) || price <= 0) return;
  if (!series || !bars.length) return;
  const last = bars[bars.length - 1];
  const hi = Math.max(last.high, price);
  const lo = Math.min(last.low, price);
  const next = { time: last.time, open: last.open, high: hi, low: lo, close: price };
  try {
    series.update(next);
  } catch {
    return;
  }
  bars[bars.length - 1] = next;
}

function formatChartError(e) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function isAbortLikeError(err) {
  if (!err) return false;
  if (err?.name === "AbortError") return true;
  const msg = formatChartError(err);
  return msg.includes("aborted") || msg.includes("AbortError");
}

export default function TokenPriceChart({
  mint,
  livePriceUsd = null,
  marketCapSol = null,
  onMigrationSync,
}) {
  const chartHostRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const poolRef = useRef(null);
  const lastBarsRef = useRef([]);
  const livePriceRef = useRef(null);
  const onMigrationSyncRef = useRef(onMigrationSync);
  const marketCapSolRef = useRef(marketCapSol);
  onMigrationSyncRef.current = onMigrationSync;
  const roRef = useRef(null);
  livePriceRef.current = livePriceUsd;
  marketCapSolRef.current = marketCapSol;
  const [phase, setPhase] = useState("loading");
  const [overlayText, setOverlayText] = useState("Loading chart…");
  const [errorDetail, setErrorDetail] = useState(null);

  useLayoutEffect(() => {
    if (!mint) {
      setPhase("empty");
      setOverlayText("No contract address.");
      setErrorDetail(null);
      return undefined;
    }

    const el = chartHostRef.current;
    if (!el) {
      return undefined;
    }

    let cancelled = false;
    let pollId = null;
    let pollBusy = false;

    setPhase("loading");
    setOverlayText("Loading chart…");
    setErrorDetail(null);

    (async () => {
      try {
        /**
         * Chart refresh strategy (bonding → PumpSwap):
         * 1) Pool list TTL is short (geckoTerminal) so Gecko’s ranking can pick up the new pool.
         * 2) resolveBestPoolForOhlcv probes volume-ranked pools until minute OHLCV is recent.
         * 3) When marketCapSol is in the high bonding band (~60–97 SOL), we open with a fresh
         *    pool list and use tighter “stale candle” detection so migration is caught quickly.
         */
        const pool = await fetchBestPoolAddress(mint, {
          aggregate: CHART_AGGREGATE,
          limit: CHART_LIMIT,
          forceRefresh: inMigrationChartSyncWindow(marketCapSol),
        });
        if (cancelled) return;
        if (!pool) {
          setPhase("blocked");
          setOverlayText("No DEX pool indexed for this mint yet.");
          return;
        }

        const data = await fetchMinuteOhlcv(pool, {
          aggregate: CHART_AGGREGATE,
          limit: CHART_LIMIT,
        });
        if (cancelled) return;
        if (data.length === 0) {
          setPhase("blocked");
          setOverlayText("No OHLCV history for the top pool.");
          return;
        }

        const rawW = el.clientWidth || el.parentElement?.clientWidth || 400;
        const w = Math.max(320, rawW);
        const h = 260;

        const fontSans =
          typeof document !== "undefined"
            ? getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() ||
              'Inter, system-ui, sans-serif'
            : 'Inter, system-ui, sans-serif';

        if (CHART_DEBUG) {
          console.log("[VerdaChart] creating chart", {
            mint: mint?.slice?.(0, 8) + "…",
            width: w,
            height: h,
            bars: data.length,
          });
        }

        const chart = createChart(el, {
          width: w,
          height: h,
          localization: {
            priceFormatter: (p) => formatChartUsdAxis(p),
          },
          layout: {
            background: { type: ColorType.Solid, color: "#0c0f14" },
            textColor: "#b9c0d0",
            fontSize: 11,
            fontFamily: fontSans,
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.06)" },
            horzLines: { color: "rgba(255,255,255,0.06)" },
          },
          rightPriceScale: {
            borderColor: "rgba(255,255,255,0.12)",
            scaleMargins: { top: 0.08, bottom: 0.12 },
          },
          timeScale: {
            borderColor: "rgba(255,255,255,0.12)",
            timeVisible: true,
            secondsVisible: false,
          },
          crosshair: {
            vertLine: { color: "rgba(160,190,255,0.35)" },
            horzLine: { color: "rgba(160,190,255,0.35)" },
          },
        });

        const series = chart.addCandlestickSeries({
          upColor: "#3dd68c",
          downColor: "#ff6b6b",
          borderUpColor: "#3dd68c",
          borderDownColor: "#ff6b6b",
          wickUpColor: "#3dd68c",
          wickDownColor: "#ff6b6b",
          priceFormat: {
            type: "custom",
            minMove: 1e-12,
            formatter: (p) => formatChartUsdAxis(p),
          },
        });
        series.setData(data);
        lastBarsRef.current = cloneBars(data);
        mergeLiveIntoLastBar(series, lastBarsRef.current, livePriceRef.current);
        chart.timeScale().fitContent();

        chartRef.current = chart;
        seriesRef.current = series;
        poolRef.current = pool;

        if (cancelled) return;

        pollId = window.setInterval(() => {
          if (cancelled || pollBusy || !seriesRef.current || !poolRef.current) return;
          pollBusy = true;
          const watchdog = window.setTimeout(() => {
            pollBusy = false;
          }, 28_000);
          (async () => {
            try {
              const migrationWindow = inMigrationChartSyncWindow(marketCapSolRef.current);
              const aggressive = shouldAggressivelyRefreshChartPools(marketCapSolRef.current);
              const staleOpts = migrationWindow || aggressive ? { maxAgeSec: 75 } : {};

              /** Every OHLCV_POLL_MS (~10s): force fresh pool ranking while bonding / post-migrate. */
              if (migrationWindow) {
                const newPool = await fetchBestPoolAddress(mint, {
                  aggregate: CHART_AGGREGATE,
                  limit: CHART_LIMIT,
                  forceRefresh: true,
                });
                if (cancelled || !seriesRef.current) return;
                if (newPool) poolRef.current = newPool;
              }

              let fresh = await fetchMinuteOhlcv(poolRef.current, {
                aggregate: CHART_AGGREGATE,
                limit: CHART_LIMIT,
                forceRefresh: true,
              });
              if (cancelled || !seriesRef.current) return;

              if (migrationWindow && (fresh.length === 0 || ohlcvBarsLookStale(fresh, CHART_AGGREGATE, staleOpts))) {
                const newPool = await fetchBestPoolAddress(mint, {
                  aggregate: CHART_AGGREGATE,
                  limit: CHART_LIMIT,
                  forceRefresh: true,
                });
                if (cancelled || !seriesRef.current) return;
                if (newPool && newPool !== poolRef.current) {
                  poolRef.current = newPool;
                  fresh = await fetchMinuteOhlcv(poolRef.current, {
                    aggregate: CHART_AGGREGATE,
                    limit: CHART_LIMIT,
                    forceRefresh: true,
                  });
                }
              }

              if (
                !migrationWindow &&
                (fresh.length === 0 || ohlcvBarsLookStale(fresh, CHART_AGGREGATE, staleOpts))
              ) {
                if (CHART_DEBUG) {
                  console.log(
                    "[VerdaChart] OHLCV empty/stale — re-resolving pool (migration / venue change)"
                  );
                }
                const newPool = await fetchBestPoolAddress(mint, {
                  aggregate: CHART_AGGREGATE,
                  limit: CHART_LIMIT,
                  forceRefresh: true,
                });
                if (cancelled || !seriesRef.current) return;
                if (newPool && newPool !== poolRef.current) {
                  poolRef.current = newPool;
                }
                fresh = await fetchMinuteOhlcv(poolRef.current, {
                  aggregate: CHART_AGGREGATE,
                  limit: CHART_LIMIT,
                  forceRefresh: true,
                });
              }

              if (cancelled || !seriesRef.current) return;
              if (fresh.length > 0) {
                const s = seriesRef.current;
                const snap = cloneBars(fresh);
                s.setData(fresh);
                lastBarsRef.current = snap;
                mergeLiveIntoLastBar(s, lastBarsRef.current, livePriceRef.current);
                if (migrationWindow) {
                  try {
                    onMigrationSyncRef.current?.();
                  } catch (err) {
                    console.error("[VerdaChart] onMigrationSync failed", err);
                  }
                }
              }
            } catch (e) {
              if (isAbortLikeError(e)) {
                try {
                  const fallbackPool = await fetchBestPoolAddress(mint, {
                    aggregate: CHART_AGGREGATE,
                    limit: CHART_LIMIT,
                    forceRefresh: true,
                  });
                  if (!cancelled && seriesRef.current && fallbackPool) {
                    poolRef.current = fallbackPool;
                  }
                } catch {
                  /* ignore pool recovery failure */
                }
              }
              console.error("[VerdaChart] OHLCV poll failed", e);
            } finally {
              window.clearTimeout(watchdog);
              pollBusy = false;
            }
          })();
        }, OHLCV_POLL_MS);

        const ro = new ResizeObserver((entries) => {
          if (!chartRef.current || !entries[0]) return;
          const { width, height } = entries[0].contentRect;
          const nw = Math.max(320, width);
          if (nw > 0 && height > 0) {
            chartRef.current.applyOptions({ width: nw, height });
          }
        });
        ro.observe(el);
        roRef.current = ro;

        setPhase("ready");
        setOverlayText("");
        setErrorDetail(null);
        if (CHART_DEBUG) {
          console.log("[VerdaChart] chart ready", mint?.slice?.(0, 8) + "…", data.length, "bars");
        }
      } catch (e) {
        const detail = formatChartError(e);
        console.error("[VerdaChart] TokenPriceChart load failed", detail, e);
        if (!cancelled) {
          setPhase("blocked");
          setErrorDetail(detail);
          const msg = String(detail);
          if (msg.includes("429")) {
            setOverlayText(
              "Chart data is rate-limited. Wait a few seconds and open this token again."
            );
          } else {
            setOverlayText("Could not load chart data. Try again later.");
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pollId != null) {
        window.clearInterval(pollId);
        pollId = null;
      }
      seriesRef.current = null;
      poolRef.current = null;
      lastBarsRef.current = [];
      if (roRef.current) {
        try {
          roRef.current.disconnect();
        } catch {
          /* ignore */
        }
        roRef.current = null;
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [mint, chartPoolResolutionEpoch(marketCapSol)]);

  /** Nudge the last candle toward scanner price / implied MC so the chart tracks your “Live” header. */
  useEffect(() => {
    if (phase !== "ready") return undefined;

    const tick = () =>
      mergeLiveIntoLastBar(seriesRef.current, lastBarsRef.current, livePriceRef.current);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, mint]);

  /** Apply stream-driven price as soon as the parent pushes a new MC / price (no 1s tick delay). */
  useEffect(() => {
    if (phase !== "ready") return;
    mergeLiveIntoLastBar(seriesRef.current, lastBarsRef.current, livePriceUsd);
  }, [livePriceUsd, phase, mint]);

  return (
    <section className="tpc" aria-label="Price chart">
      <div className="tpc-head">
        <h2 className="tpc-title">Price · USD</h2>
        <div className="tpc-head-meta">
          <span className="tpc-sub">1m candles · synced pool · live last price</span>
        </div>
      </div>

      <div className="tpc-chart-host">
        {phase !== "ready" && (
          <div
            className={`tpc-overlay ${phase === "loading" ? "tpc-overlay--loading" : ""}`}
          >
            <div className="tpc-overlay-inner">
              <p className="tpc-overlay-msg">{overlayText}</p>
              {errorDetail && phase === "blocked" && (
                <pre className="tpc-err-detail" title={errorDetail}>
                  {errorDetail}
                </pre>
              )}
            </div>
          </div>
        )}
        <div
          ref={chartHostRef}
          className="tpc-chart-canvas"
          style={{ visibility: phase === "ready" ? "visible" : "hidden" }}
          role="img"
          aria-hidden={phase !== "ready"}
        />
      </div>

      <div className="tpc-foot">
        <a
          className="tpc-link"
          href={geckoTokenUrl(mint)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open on GeckoTerminal →
        </a>
        <span className="tpc-attrib">Free on-chain data</span>
      </div>
    </section>
  );
}
