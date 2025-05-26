import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./style.css";

document.getElementById("enter-site").addEventListener("click", () => {
  document.getElementById("intro-screen").style.display = "none";
  document.getElementById("root").style.display = "block";
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
