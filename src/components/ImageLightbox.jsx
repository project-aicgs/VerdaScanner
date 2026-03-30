import React, { useEffect } from "react";
import "./ImageLightbox.css";

export default function ImageLightbox({ src, alt, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!src) return null;

  return (
    <div
      className="img-lightbox-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      <button
        type="button"
        className="img-lightbox-close"
        aria-label="Close preview"
        onClick={onClose}
      >
        ×
      </button>
      <div
        className="img-lightbox-frame"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt || ""}
          className="img-lightbox-img"
          draggable={false}
        />
      </div>
    </div>
  );
}
