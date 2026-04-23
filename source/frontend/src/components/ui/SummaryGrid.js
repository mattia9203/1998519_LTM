import React from "react";
import styles from "./SummaryCard.module.css";

export default function SummaryGrid({ children }) {
  return <div className={styles.summaryGrid}>{children}</div>;
}
