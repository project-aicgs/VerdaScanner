import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./style.css";

const introScreen = document.getElementById("intro-screen");

function initIntroCursorLight() {
  if (!introScreen) return () => {};

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let detachMove = () => {};

  const setLightPx = (x, y) => {
    introScreen.style.setProperty("--mx", `${x}px`);
    introScreen.style.setProperty("--my", `${y}px`);
  };

  const centerFromRect = () => {
    const r = introScreen.getBoundingClientRect();
    setLightPx(r.width / 2, r.height / 2);
  };

  const runSmoothed = () => {
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let rafId = 0;

    const syncTargetsFromClient = (clientX, clientY) => {
      const rect = introScreen.getBoundingClientRect();
      targetX = clientX - rect.left;
      targetY = clientY - rect.top;
    };

    const tick = () => {
      curX += (targetX - curX) * 0.14;
      curY += (targetY - curY) * 0.14;
      setLightPx(curX, curY);
      const dx = targetX - curX;
      const dy = targetY - curY;
      if (dx * dx + dy * dy > 0.25) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = 0;
      }
    };

    const onMove = (e) => {
      syncTargetsFromClient(e.clientX, e.clientY);
      if (!rafId) rafId = requestAnimationFrame(tick);
    };

    const onTouch = (e) => {
      if (e.touches.length === 0) return;
      const t = e.touches[0];
      syncTargetsFromClient(t.clientX, t.clientY);
      if (!rafId) rafId = requestAnimationFrame(tick);
    };

    centerFromRect();
    const r = introScreen.getBoundingClientRect();
    curX = r.width / 2;
    curY = r.height / 2;
    targetX = curX;
    targetY = curY;
    setLightPx(curX, curY);

    document.addEventListener("mousemove", onMove);
    introScreen.addEventListener("touchstart", onTouch, { passive: true });
    introScreen.addEventListener("touchmove", onTouch, { passive: true });
    detachMove = () => {
      document.removeEventListener("mousemove", onMove);
      introScreen.removeEventListener("touchstart", onTouch);
      introScreen.removeEventListener("touchmove", onTouch);
      if (rafId) cancelAnimationFrame(rafId);
    };
  };

  const apply = () => {
    detachMove();
    if (reduceMotion.matches) {
      centerFromRect();
      return;
    }
    runSmoothed();
  };

  apply();
  reduceMotion.addEventListener("change", apply);

  return () => {
    reduceMotion.removeEventListener("change", apply);
    detachMove();
  };
}

const teardownIntroLight = initIntroCursorLight();

document.getElementById("enter-site").addEventListener("click", () => {
  teardownIntroLight();
  introScreen.style.display = "none";
  document.getElementById("root").style.display = "block";
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
