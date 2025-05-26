import React, { useEffect, useState } from "react";
import "./ModalStyles.css";

export default function TokenModal({ token, onClose, onCopy }) {
  if (!token) return null;

  const {
    mint,
    name,
    symbol,
    description,
    image,
    devPercent,
    volumeUSD,
    marketCapUSD,
    kols = [],
  } = token;

  const [currentVolume, setCurrentVolume] = useState(volumeUSD);
  const [currentMarketCap, setCurrentMarketCap] = useState(marketCapUSD);
  const [currentDevPercent, setCurrentDevPercent] = useState(devPercent);

  // This will update the data when the parent state changes
  useEffect(() => {
    if (volumeUSD !== currentVolume) {
      setCurrentVolume(volumeUSD);
    }
    if (marketCapUSD !== currentMarketCap) {
      setCurrentMarketCap(marketCapUSD);
    }
    if (devPercent !== currentDevPercent) {
      setCurrentDevPercent(devPercent);
    }
  }, [volumeUSD, marketCapUSD, devPercent]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>✖</button>

        {image && (
          <div className="modal-image-container">
            <img src={image} alt={symbol} className="modal-image" />
          </div>
        )}

        <h2>{name || "Unnamed Token"} ({symbol || "???"})</h2>

        {kols.length > 0 && (
          <div className="kol-tag">Seen by: {kols.join(" & ")}</div>
        )}

        {description && <p className="description">{description}</p>}

        <div className="modal-stats">
          {devPercent !== undefined && (
            <p><strong>Dev Holdings:</strong> {currentDevPercent.toFixed(2)}%</p>
          )}

          {currentVolume !== undefined && (
            <p><strong>Volume:</strong> ${currentVolume.toFixed(2)}</p>
          )}

          {currentMarketCap !== undefined && (
            <p><strong>Market Cap:</strong> ${currentMarketCap.toFixed(2)}</p>
          )}
        </div>

        <p>
          <strong>Contract Address:</strong>{" "}
          <span
            className="contract-address"
            onClick={() => onCopy(mint)}
            title="Click to copy"
          >
            {mint}
          </span>
        </p>
      </div>
    </div>
  );
}
