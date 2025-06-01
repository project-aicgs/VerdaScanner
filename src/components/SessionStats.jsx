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
    sessionDuration: "0m"
  });

  // Calculate session statistics
  useEffect(() => {
    const calculateStats = () => {
      const allTokens = getAllTokens();
      
      // Filter tokens that were called during this session
      const sessionTokens = allTokens.filter(token => {
        const tokenTime = new Date(token.calledAt || token.lastUpdated);
        return tokenTime >= sessionStartTime;
      });

      const totalCalled = sessionTokens.length;
      
      // Calculate gains for each token
      const tokenGains = sessionTokens.map(token => {
        const initial = token.initialMarketCap || 0;
        const peak = token.peakMarketCap || 0;
        return initial > 0 ? ((peak - initial) / initial) * 100 : 0;
      });

      // Count winners (50%+ gain)
      const winners = tokenGains.filter(gain => gain >= 50).length;
      const winRate = totalCalled > 0 ? (winners / totalCalled) * 100 : 0;

      // Calculate average gains
      const averageGain = tokenGains.length > 0 ? 
        tokenGains.reduce((sum, gain) => sum + gain, 0) / tokenGains.length : 0;
      
      const winnerGains = tokenGains.filter(gain => gain >= 50);
      const averageWinnerGain = winnerGains.length > 0 ? 
        winnerGains.reduce((sum, gain) => sum + gain, 0) / winnerGains.length : 0;

      // Find best and worst performers
      const bestGain = tokenGains.length > 0 ? Math.max(...tokenGains) : 0;
      const worstGain = tokenGains.length > 0 ? Math.min(...tokenGains) : 0;

      // Calculate session duration
      const now = new Date();
      const durationMs = now - sessionStartTime;
      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      const sessionDuration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

      setStats({
        totalCalled,
        winners,
        winRate,
        bestGain,
        worstGain,
        averageGain,
        averageWinnerGain,
        sessionDuration
      });
    };

    // Calculate immediately
    calculateStats();

    // Update every 5 seconds
    const interval = setInterval(calculateStats, 5000);
    return () => clearInterval(interval);
  }, [sessionStartTime]);

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const getWinRateColor = (winRate) => {
    if (winRate >= 50) return '#00ff88';
    if (winRate >= 30) return '#ffcc00';
    if (winRate >= 15) return '#ff8844';
    return '#ff6644';
  };

  return (
    <div className="session-stats-overlay" onClick={onClose}>
      <div className="session-stats-modal" onClick={(e) => e.stopPropagation()}>
        <div className="session-stats-header">
          <h2>📈 Session Win Rate</h2>
          <button className="close-btn" onClick={onClose}>✖</button>
        </div>
        
        <div className="session-stats-content">
          <div className="session-info">
            <div className="session-detail">
              <span className="detail-label">Session Started:</span>
              <span className="detail-value">{formatTime(sessionStartTime)}</span>
            </div>
            <div className="session-detail">
              <span className="detail-label">Duration:</span>
              <span className="detail-value">{stats.sessionDuration}</span>
            </div>
          </div>

          <div className="win-rate-display">
            <div className="win-rate-circle">
              <div 
                className="win-rate-percentage"
                style={{ color: getWinRateColor(stats.winRate) }}
              >
                {stats.winRate.toFixed(1)}%
              </div>
              <div className="win-rate-label">Win Rate</div>
            </div>
          </div>

          <div className="session-metrics">
            <div className="metric-row">
              <div className="metric">
                <span className="metric-label">Total Calls:</span>
                <span className="metric-value">{stats.totalCalled}</span>
              </div>
              <div className="metric">
                <span className="metric-label">Winners (50%+):</span>
                <span className="metric-value winners">{stats.winners}</span>
              </div>
            </div>
            
            <div className="metric-row">
              <div className="metric">
                <span className="metric-label">Best Performer:</span>
                <span className="metric-value best">+{stats.bestGain.toFixed(1)}%</span>
              </div>
              <div className="metric">
                <span className="metric-label">Worst Performer:</span>
                <span className="metric-value worst">{stats.worstGain.toFixed(1)}%</span>
              </div>
            </div>

            <div className="metric-row">
              <div className="metric">
                <span className="metric-label">Average Gain:</span>
                <span className={`metric-value ${stats.averageGain >= 0 ? 'positive' : 'negative'}`}>
                  {stats.averageGain >= 0 ? '+' : ''}{stats.averageGain.toFixed(1)}%
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">Avg Winner Gain:</span>
                <span className="metric-value avg-winner">
                  {stats.averageWinnerGain > 0 ? `+${stats.averageWinnerGain.toFixed(1)}%` : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          <div className="performance-indicator">
            {stats.winRate >= 50 && (
              <div className="performance-badge excellent">🔥 Excellent Performance!</div>
            )}
            {stats.winRate >= 30 && stats.winRate < 50 && (
              <div className="performance-badge good">✅ Good Performance</div>
            )}
            {stats.winRate >= 15 && stats.winRate < 30 && (
              <div className="performance-badge average">⚡ Average Performance</div>
            )}
            {stats.winRate < 15 && stats.totalCalled > 0 && (
              <div className="performance-badge poor">📈 Room for Improvement</div>
            )}
            {stats.totalCalled === 0 && (
              <div className="performance-badge waiting">⏳ Waiting for first call...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}