import React from "react";

export default function Skeleton({ width = "100%", height = "100%", className = "" }) {
  return (
    <div
      className={`skeleton-box ${className}`}
      style={{ width, height }}
    />
  );
}
