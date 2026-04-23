import React from "react";
import styles from "./SummaryCard.module.css";

export default function SummaryCard({ label, value, isAccent, accentColor }) {
  const cardClass = `${styles.summaryCard}${isAccent ? ` ${styles.summaryCardAccent}` : ""}`;
  return (
    <div className={cardClass}>
      <div className={styles.summaryCardLabel}>{label}</div>
      <div
        className={styles.summaryCardValue}
        style={isAccent ? { color: accentColor } : {}}
      >
        {value}
      </div>
    </div>
  );
}
