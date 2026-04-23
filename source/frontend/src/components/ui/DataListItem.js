import React from "react";
import styles from "./DataListItem.module.css";

export default function DataListItem({ label, value, valueTitle, isDetail }) {
  return (
    <div className={styles.dataListItem}>
      <span className={styles.dataListLabel}>{label}</span>
      <span
        title={valueTitle}
        className={`${styles.dataListValue}${!isDetail ? ` ${styles.dataListValueMuted}` : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
