import React from "react";
import { useNavigate } from "react-router-dom";
import {
  categoryLabel,
  formatCoordinates,
  formatFrequency,
  sensorDisplayId,
} from "../utils/platform";
import DataListItem from "./ui/DataListItem";
import StatusBadge from "./ui/StatusBadge";
import styles from "./SensorCard.module.css";
import dataListItemStyles from "./ui/DataListItem.module.css";

export default function SensorCard({ sensor, latestEvent }) {
  const navigate = useNavigate();

  return (
    <article className={styles.sensorCard}>
      <div className={styles.sensorCardHeader}>
        <h2 className={styles.sensorCardTitle}>
          {sensorDisplayId(sensor.sensor_id)}
        </h2>
        <StatusBadge label={categoryLabel(sensor.category)} />
      </div>

      <div className={dataListItemStyles.dataList}>
        <DataListItem label="Region" value={sensor.region} />
        
        <DataListItem 
          label="Coordinates" 
          value={formatCoordinates(sensor.latitude, sensor.longitude)} 
        />
        
        <DataListItem
          label="Last Event"
          isMuted
          value={
            latestEvent ? (
              <StatusBadge type={latestEvent.event_type} />
            ) : (
              "No recent event"
            )
          }
        />
        
        <DataListItem
          label="Dom. Freq."
          isMuted
          value={
            latestEvent ? formatFrequency(latestEvent.peak_frequency) : "N/A"
          }
        />
      </div>

      <div className={styles.sensorCardActions}>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            latestEvent &&
            navigate(`/event/${encodeURIComponent(latestEvent.event_id)}`)
          }
          disabled={!latestEvent}
        >
          Event
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            navigate(
              `/history?sensor_id=${encodeURIComponent(sensor.sensor_id)}`
            )
          }
        >
          History
        </button>
      </div>
    </article>
  );
}
