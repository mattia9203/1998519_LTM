import React from "react";
import { eventTypeBadge } from "../../utils/platform";
import styles from "./StatusBadge.module.css";

export default function StatusBadge({ type, label, customClass = "" }) {
  // Se viene passato un type (es. evento sismico), usa le utility di piattaforma
  if (type) {
    const isEarthquake = type === "earthquake" || type === "event-earthquake";
    const isExplosion = type === "conventional_explosion" || type === "event-explosion";
    const isNuclear = type === "nuclear_like" || type === "event-nuclear";

    let badgeClass = styles.pill;
    if (isEarthquake) badgeClass += ` ${styles.pillEventEarthquake}`;
    else if (isExplosion) badgeClass += ` ${styles.pillEventExplosion}`;
    else if (isNuclear) badgeClass += ` ${styles.pillEventNuclear}`;

    if (customClass) badgeClass += ` ${customClass}`;

    return (
      <span className={badgeClass}>
        {eventTypeBadge(type)}
      </span>
    );
  }

  // Altrimenti mostriamo una label generica
  return <span className={`${styles.pill} ${customClass}`.trim()}>{label}</span>;
}
