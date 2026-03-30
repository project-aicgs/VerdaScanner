import React, { useState, useEffect } from "react";
import { getAllTokens } from "../utils/leaderboardStore";
import "./SessionStats.css";

export default function SessionStats({ onClose, sessionStartTime }) {
  const [stats, setStats] = useState({
    totalCalled: 0,
    winners: 0,
    winRate: 0,
    bestGain: 0,
    worstGain: 0,
    averageGain: 0,
    averageWinnerGain: 0,
    sessionDuration: "0m",
  });

  useEffect(() => {
    const calculateStats = () => {
      const allTokens = getAllTokens();

      const sessionTokens = allTokens.filter((token) => {
        const tokenTime = new Date(token.calledAt || token.lastUpdated);
        return tokenTime >= sessionStartTime;
      });

      const totalCalled = sessionTokens.length;

      const tokenGains = sessionTokens.map((token) => {
        const initial = token.initialMarketCap || 0;
        const peak = token.peakMarketCap || 0;
        return initial > 0 ? ((peak - initial) / initial) * 100 : 0;
      });

      const winners = tokenGains.filter((gain) => gain >= 50).length;
      const winRate = totalCalled > 0 ? (winners / totalCalled) * 100 : 0;

      const averageGain =
        tokenGains.length > 0
          ? tokenGains.reduce((sum, gain) => sum + gain, 0) / tokenGains.length
          : 0;

      const winnerGains = tokenGains.filter((gain) => gain >= 50);
      const averageWinnerGain =
        winnerGains.length > 0
          ? winnerGains.reduce((sum, gain) => sum + gain, 0) /
            winnerGains.length
          : 0;

      const bestGain = tokenGains.length > 0 ? Math.max(...tokenGains) : 0;
      const worstGain = tokenGains.length > 0 ? Math.min(...tokenGains) : 0;

      const now = new Date();
      const durationMs = now - sessionStartTime;
      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor(
        (durationMs % (1000 * 60 * 60)) / (1000 * 60)
      );
      const sessionDuration =
        hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

      setStats({
        totalCalled,
        winners,
        winRate,
        bestGain,
        worstGain,
        averageGain,
        averageWinnerGain,
        sessionDuration,
      });
    };

    calculateStats();
    const interval = setInterval(calculateStats, 5000);
    return () => clearInterval(interval);
  }, [sessionStartTime]);

  const formatTime = (date) =>
    date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

  const footerMessage =
    stats.totalCalled === 0
      ? "Awaiting smart wallet activity…"
      : "Session in progress";

  const avgWinnerDisplay =
    stats.averageWinnerGain > 0
      ? `+${stats.averageWinnerGain.toFixed(1)}%`
      : "N/A";

  const worstDisplay =
    stats.totalCalled === 0
      ? "0.0%"
      : `${stats.worstGain >= 0 ? "+" : ""}${stats.worstGain.toFixed(1)}%`;

  const avgGainDisplay =
    stats.totalCalled === 0
      ? "+0.0%"
      : `${stats.averageGain >= 0 ? "+" : ""}${stats.averageGain.toFixed(1)}%`;

  return (
    <div className="swr-overlay" onClick={onClose} role="presentation">
      <div
        className="swr-shell"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="swr-title"
      >
        <button
          type="button"
          className="swr-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        <h1 id="swr-title" className="swr-title">
          Win Rate
        </h1>

        <div className="swr-body">
          <div className="swr-col swr-col--left">
            <div className="swr-session-box">
              <div className="swr-session-field">
                <span className="swr-session-label">Session Started</span>
                <span className="swr-session-value">
                  {formatTime(sessionStartTime)}
                </span>
              </div>
              <div className="swr-session-field">
                <span className="swr-session-label">Duration</span>
                <span className="swr-session-value">
                  {stats.sessionDuration}
                </span>
              </div>
            </div>

            <div className="swr-stack-wrap">
              <div className="swr-stack" aria-label="Win rate">
                <div className="swr-stack-layer swr-stack-layer--back" />
                <div className="swr-stack-layer swr-stack-layer--mid" />
                <div className="swr-stack-layer swr-stack-layer--front">
                  <span className="swr-stack-pct">
                    {stats.winRate.toFixed(1)}%
                  </span>
                  <span className="swr-stack-label">Win Rate</span>
                </div>
              </div>
            </div>
          </div>

          <div className="swr-stat-grid" aria-label="Session statistics">
            <div className="swr-stat-card">
              <span className="swr-stat-label">Session picks:</span>
              <span className="swr-stat-value">{stats.totalCalled}</span>
            </div>
            <div className="swr-stat-card">
              <span className="swr-stat-label">Winners (50%+):</span>
              <span className="swr-stat-value">{stats.winners}</span>
            </div>
            <div className="swr-stat-card">
              <span className="swr-stat-label">Best Performer:</span>
              <span className="swr-stat-value">
                +{stats.bestGain.toFixed(1)}%
              </span>
            </div>
            <div className="swr-stat-card">
              <span className="swr-stat-label">Worst Performer:</span>
              <span className="swr-stat-value">{worstDisplay}</span>
            </div>
            <div className="swr-stat-card">
              <span className="swr-stat-label">Average Gain:</span>
              <span className="swr-stat-value">{avgGainDisplay}</span>
            </div>
            <div className="swr-stat-card">
              <span className="swr-stat-label">Avg Winner Gain:</span>
              <span className="swr-stat-value">{avgWinnerDisplay}</span>
            </div>
          </div>
        </div>

        <div className="swr-footer">
          <div className="swr-footer-pill">{footerMessage}</div>
        </div>
      </div>
    </div>
  );
}
