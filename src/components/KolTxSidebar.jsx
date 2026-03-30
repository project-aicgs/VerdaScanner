import React, { useEffect, useMemo, useRef, useState } from "react";
import { formatMarketCap } from "../utils/formatUtils";
import { tokenContentAllowed } from "../utils/contentFilter";
import {
  isKolBumpMessage,
  sameKolWalletAndMint,
} from "../utils/kolBumping.js";
import "./KolTxSidebar.css";

/**
 * Log is newest-first. For a row that qualifies as a bump, the chronologically **preceding**
 * entry is the next item in the array (older). Merge into one line +N while each preceding
 * row is also a bump for the **same trader** (and same mint) as the row immediately newer
 * than it — i.e. same-trader bump chains don’t fragment.
 */
function groupSidebarLines(visible) {
  const out = [];
  let i = 0;
  while (i < visible.length) {
    const row = visible[i];
    if (isKolBumpMessage(row)) {
      let count = 1;
      let j = i + 1;
      let newerInChain = row;
      while (j < visible.length) {
        const preceding = visible[j];
        if (!isKolBumpMessage(preceding)) break;
        if (!sameKolWalletAndMint(preceding, newerInChain)) break;
        count += 1;
        newerInChain = preceding;
        j += 1;
      }
      out.push({ kind: "bump", head: row, count });
      i = j;
    } else {
      out.push({ kind: "buy", row });
      i += 1;
    }
  }
  return out;
}

function KolBuyLine({ row, onLineClick }) {
  return (
    <button
      type="button"
      role="listitem"
      className="kol-tx-line kol-tx-line--flash-enter"
      onClick={() => onLineClick?.(row)}
    >
      <span className="kol-tx-line-inner">
        <span className="kol-tx-line-row kol-tx-line-row--top">
          <strong className="kol-tx-kol">{row.kolName}</strong>
          <span className="kol-tx-mid"> bought </span>
          <span className="kol-tx-pct">{row.ownershipPercentage.toFixed(2)}%</span>
          <span className="kol-tx-mid"> of </span>
          <span className="kol-tx-token">{row.symbol || "???"}</span>
        </span>
        <span className="kol-tx-line-row kol-tx-line-row--mc">
          <span className="kol-tx-mc-label">MC at buy</span>
          <span className="kol-tx-mc">{formatMarketCap(row.buyMarketCapUSD)}</span>
        </span>
      </span>
    </button>
  );
}

function KolBumpGroupLine({ head, count, onLineClick }) {
  const prevCountRef = useRef(0);
  const [streakPulse, setStreakPulse] = useState(false);

  useEffect(() => {
    const prev = prevCountRef.current;
    if (count > prev && prev >= 1) {
      setStreakPulse(true);
      const t = window.setTimeout(() => setStreakPulse(false), 720);
      prevCountRef.current = count;
      return () => window.clearTimeout(t);
    }
    prevCountRef.current = count;
  }, [count]);

  const showBadge = count >= 2;

  return (
    <button
      type="button"
      role="listitem"
      className={[
        "kol-tx-line",
        "kol-tx-line--flash-enter",
        streakPulse ? "kol-tx-line--bump-streak" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onLineClick?.(head)}
    >
      <span className="kol-tx-line-inner">
        <span className="kol-tx-line-row kol-tx-line-row--top kol-tx-line-row--split">
          <span className="kol-tx-line-text">
            <strong className="kol-tx-kol">{head.kolName}</strong>
            <span className="kol-tx-mid"> is bumping </span>
            <span className="kol-tx-token">{head.name?.trim() || head.symbol || "???"}</span>
          </span>
          {showBadge && (
            <span className="kol-tx-bump-badge" aria-label={`${count} bumps`}>
              +{count}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export default function KolTxSidebar({ lines, excludedKols = [], onLineClick }) {
  const visible = useMemo(
    () =>
      lines.filter(
        (row) =>
          row &&
          row.kolName &&
          !excludedKols.includes(row.kolName) &&
          row.ownershipPercentage != null &&
          row.ownershipPercentage < 10 &&
          tokenContentAllowed(row.symbol, row.name)
      ),
    [lines, excludedKols]
  );

  const grouped = useMemo(() => groupSidebarLines(visible), [visible]);

  return (
    <aside className="kol-tx-sidebar" aria-label="Smart wallet buys">
      <div className="kol-tx-sidebar-head">
        <h2 className="kol-tx-sidebar-title">Smart wallet buys</h2>
        <p className="kol-tx-sidebar-sub">Newest first · click a line for details</p>
      </div>
      <div className="kol-tx-sidebar-scroll" role="list">
        {grouped.length === 0 ? (
          <p className="kol-tx-sidebar-empty" role="status">
            Awaiting smart wallet transactions…
          </p>
        ) : (
          grouped.map((item, idx) =>
            item.kind === "bump" ? (
              <KolBumpGroupLine
                key={`bump-${item.head.id ?? `${item.head.mint}-${idx}`}`}
                head={item.head}
                count={item.count}
                onLineClick={onLineClick}
              />
            ) : (
              <KolBuyLine key={item.row.id} row={item.row} onLineClick={onLineClick} />
            )
          )
        )}
      </div>
    </aside>
  );
}
