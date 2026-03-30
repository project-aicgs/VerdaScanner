import React, { useEffect, useRef } from "react";
import "./KolFilter.css";
import { ALL_KOL_NAMES as ALL_KOLS } from "../constants/kolWallets.js";

export default function KolFilter({ excludedKols, onKolToggle, onClose }) {
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const handleKolToggle = (kolName) => {
    onKolToggle(kolName);
  };

  return (
    <div className="kol-filter-overlay">
      <div className="kol-filter-dropdown" ref={dropdownRef}>
        <div className="kol-filter-header">
          <span>Smart Wallet Filter</span>
          <button 
            className="select-all-btn"
            onClick={() => {
              // Toggle all: if any are excluded, include all; if none excluded, exclude all
              if (excludedKols.length > 0) {
                // Clear all exclusions (show all)
                excludedKols.forEach(kol => onKolToggle(kol));
              } else {
                // Exclude all
                ALL_KOLS.forEach(kol => onKolToggle(kol));
              }
            }}
          >
            {excludedKols.length > 0 ? 'Select All' : 'Deselect All'}
          </button>
        </div>
        
        <div className="kol-list">
          {ALL_KOLS.map(kolName => (
            <label key={kolName} className="kol-checkbox-item">
              <input
                type="checkbox"
                checked={!excludedKols.includes(kolName)}
                onChange={() => handleKolToggle(kolName)}
              />
              <span className="checkbox-custom"></span>
              <span className="kol-name">{kolName}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}