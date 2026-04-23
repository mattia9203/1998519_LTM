import React from "react";

export default function ErrorMessage({ message, onRetry }) {
  return (
    <div className="error-card">
      <div className="detail-panel__title" style={{ color: "var(--accent)" }}>
        Request Failed
      </div>
      <p className="detail-panel__copy">{message}</p>
      {onRetry && (
        <button
          type="button"
          className="primary-button"
          onClick={onRetry}
        >
          Retry Connection
        </button>
      )}
    </div>
  );
}
