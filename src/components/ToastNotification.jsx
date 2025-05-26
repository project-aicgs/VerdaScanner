import React from "react";
import "./ToastStyles.css";

export default function ToastNotification({ message }) {
  return (
    <div className="toast">
      {message}
    </div>
  );
}
