import React, { useState, useEffect } from "react";
import { formatMarketCap } from "../utils/formatUtils";
import { getAllTokens, getStats } from "../utils/leaderboardStore";
import "./Leaderboard.css";

export default function Leaderboard({ onClose }) {
  const [sortConfig, setSortConfig] = useState({ key: 'peakMarketCap', direction: 'desc' });
  const [toast, setToast] = useState("");
  const [tokens, setTokens] = useState([]);
  const [stats, setStats] = useState({});

  // Load data from central store
  useEffect(() => {
    const loadData = () => {
      const allTokens = getAllTokens();
      const currentStats = getStats();
      setTokens(allTokens);
      setStats(currentStats);
    };

    // Load initially
    loadData();

    // Refresh every 2 seconds to get latest data
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, []);

  // Calculate gain percentage
  const calculateGainPercent = (token) => {
    if (!token.initialMarketCap || token.initialMarketCap <= 0) return 0;
    return ((token.peakMarketCap - token.initialMarketCap) / token.initialMarketCap) * 100;
  };

  // Sort tokens based on current sort config
  const sortedTokens = [...tokens].sort((a, b) => {
    let aValue, bValue;

    switch (sortConfig.key) {
      case 'peakMarketCap':
        aValue = a.peakMarketCap || 0;
        bValue = b.peakMarketCap || 0;
        break;
      case 'initialMarketCap':
        aValue = a.initialMarketCap || 0;
        bValue = b.initialMarketCap || 0;
        break;
      case 'gainPercent':
        aValue = calculateGainPercent(a);
        bValue = calculateGainPercent(b);
        break;
      case 'calledAt':
        aValue = new Date(a.calledAt || 0).getTime();
        bValue = new Date(b.calledAt || 0).getTime();
        break;
      case 'name':
        aValue = (a.name || '').toLowerCase();
        bValue = (b.name || '').toLowerCase();
        break;
      default:
        aValue = a.peakMarketCap || 0;
        bValue = b.peakMarketCap || 0;
    }

    if (aValue < bValue) {
      return sortConfig.direction === 'asc' ? -1 : 1;
    }
    if (aValue > bValue) {
      return sortConfig.direction === 'asc' ? 1 : -1;
    }
    return 0;
  });

  // Take top 50
  const top50 = sortedTokens.slice(0, 50);

  const handleSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) {
      return '⇅';
    }
    return sortConfig.direction === 'asc' ? '▲' : '▼';
  };

  const getNextDirection = (columnKey) => {
    if (sortConfig.key !== columnKey) {
      return 'desc';
    }
    return sortConfig.direction === 'desc' ? 'asc' : 'desc';
  };

  const getGainColor = (gainPercent) => {
    if (gainPercent > 1000) return '#00ff88';
    if (gainPercent > 500) return '#44ff44';
    if (gainPercent > 100) return '#88ff00';
    if (gainPercent > 0) return '#ffcc00';
    return '#ff6644';
  };

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const now = new Date();
    const time = new Date(timestamp);
    const diffMinutes = Math.floor((now - time) / (1000 * 60));
    
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
    return `${Math.floor(diffMinutes / 1440)}d ago`;
  };

  const handleCopyAddress = (address, event) => {
    event.stopPropagation();
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

  return (
    <div className="leaderboard-overlay" onClick={onClose}>
      {toast && (
        <div className="toast">
          {toast}
        </div>
      )}
      
      <div className="leaderboard-modal" onClick={(e) => e.stopPropagation()}>
        <div className="leaderboard-header">
          <h2>🏆 Top 50 Gainers Leaderboard</h2>
          <button className="close-btn" onClick={onClose}>✖</button>
        </div>
        
        <div className="leaderboard-stats">
          <div className="stat-item">
            <span className="stat-label">Total Tracked:</span>
            <span className="stat-value">{stats.totalTokens || 0}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Showing:</span>
            <span className="stat-value">{tokens.length}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Top Peak:</span>
            <span className="stat-value">{formatMarketCap(stats.topPeakMC || 0)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">KOL Tracker:</span>
            <span className="stat-value">{stats.bullXCount || 0}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">PumpFun:</span>
            <span className="stat-value">{stats.pumpFunCount || 0}</span>
          </div>
        </div>

        <div className="leaderboard-list">
          <div className="leaderboard-headers">
            <div className="rank-header">#</div>
            <div 
              className={`sortable-header ${sortConfig.key === 'name' ? 'active' : ''}`}
              onClick={() => handleSort('name')}
              title={`Sort by name (${getNextDirection('name') === 'asc' ? 'A-Z' : 'Z-A'})`}
            >
              Token
              <span className="sort-icon">{getSortIcon('name')}</span>
            </div>
            <div 
              className={`sortable-header ${sortConfig.key === 'initialMarketCap' ? 'active' : ''}`}
              onClick={() => handleSort('initialMarketCap')}
              title={`Sort by called at MC`}
            >
              Called At
              <span className="sort-icon">{getSortIcon('initialMarketCap')}</span>
            </div>
            <div 
              className={`sortable-header ${sortConfig.key === 'peakMarketCap' ? 'active' : ''}`}
              onClick={() => handleSort('peakMarketCap')}
              title={`Sort by peak MC`}
            >
              Peak MC
              <span className="sort-icon">{getSortIcon('peakMarketCap')}</span>
            </div>
            <div 
              className={`sortable-header ${sortConfig.key === 'gainPercent' ? 'active' : ''}`}
              onClick={() => handleSort('gainPercent')}
              title={`Sort by gain %`}
            >
              Gain
              <span className="sort-icon">{getSortIcon('gainPercent')}</span>
            </div>
            <div 
              className={`sortable-header ${sortConfig.key === 'calledAt' ? 'active' : ''}`}
              onClick={() => handleSort('calledAt')}
              title={`Sort by time called`}
            >
              Called
              <span className="sort-icon">{getSortIcon('calledAt')}</span>
            </div>
            <div className="source-header">Source</div>
          </div>
          
          <div className="leaderboard-rows">
            {top50.map((token, index) => {
              const gainPercent = calculateGainPercent(token);
              
              return (
                <div 
                  key={`${token.contractAddress}-${index}`} 
                  className="leaderboard-row"
                >
                  <div className="rank">
                    {index + 1}
                    {index === 0 && <span className="crown">👑</span>}
                  </div>
                  
                  <div className="token-info">
                    <div 
                      className="copy-contract-icon" 
                      onClick={(e) => handleCopyAddress(token.contractAddress, e)}
                      title="Copy contract address"
                    >
                      <div className="copy-squares">
                        <div className="copy-square back"></div>
                        <div className="copy-square front"></div>
                      </div>
                    </div>
                    
                    {token.image && (
                      <img 
                        src={token.image} 
                        alt={token.symbol} 
                        className="token-image-small"
                        onError={(e) => e.target.style.display = 'none'}
                      />
                    )}
                    <div className="token-details">
                      <div className="token-symbol">{token.symbol || '???'}</div>
                      <div className="token-name">{token.name || 'Unnamed'}</div>
                      {token.kols && token.kols.length > 0 && (
                        <div className="token-kols">Bought by {token.kols.join(', ')}</div>
                      )}
                    </div>
                  </div>
                  
                  <div className="called-at">
                    {formatMarketCap(token.initialMarketCap || 0)}
                  </div>
                  
                  <div className="peak-mc">
                    {formatMarketCap(token.peakMarketCap || 0)}
                  </div>
                  
                  <div 
                    className="gain-percent"
                    style={{ color: getGainColor(gainPercent) }}
                  >
                    {gainPercent > 0 ? '+' : ''}{gainPercent.toFixed(1)}%
                  </div>
                  
                  <div className="time-ago">
                    {formatTimeAgo(token.calledAt)}
                  </div>
                  
                  <div className={`source ${token.source || 'unknown'}`}>
                    {token.source === 'bullx' ? '🎯' : token.source === 'pumpfun' ? '🚀' : '❓'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}