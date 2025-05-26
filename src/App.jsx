import React from "react";
import Dashboard from "./components/Dashboard.jsx";

export default function App() {
  return (
    <div className="nova-wrapper">
      <header className="nova-header">
        <img src="/logo.png" className="nova-logo" alt="NovaSage Logo" />
        <h1>NOVASAGE</h1>
        <p>AI-Powered Scanner for Solana</p>
      </header>
      <Dashboard />
    </div>
  );
}
