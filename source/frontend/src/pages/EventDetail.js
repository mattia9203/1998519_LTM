import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_BASE } from "../config";
import {
  categoryName,
  eventTypeLabel,
  formatAmplitude,
  formatCoordinates,
  formatEventDisplayId,
  formatFrequency,
  formatUtcTimestamp,
  sensorDisplayId,
} from "../utils/platform";
import StatusBadge from "../components/ui/StatusBadge";
import DataListItem from "../components/ui/DataListItem";
import Skeleton from "../components/ui/Skeleton";
import ErrorMessage from "../components/ui/ErrorMessage";
import styles from "./EventDetail.module.css";
import dataListItemStyles from "../components/ui/DataListItem.module.css";

export default function EventDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [event, setEvent] = useState(null);
  const [relatedEvents, setRelatedEvents] = useState([]);

  useEffect(() => {
    const loadEvent = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE}/events/${encodeURIComponent(id)}`);
        
        if (!response.ok) {
          throw new Error("Impossible to load event details");
        }

        const payload = await response.json();

        if (!payload.data) {
          setEvent(null);
          setRelatedEvents([]);
          setIsLoading(false);
          return;
        }

        setEvent(payload.data);

        const historyResponse = await fetch(
          `${API_BASE}/history?sensor_id=${encodeURIComponent(payload.data.sensor_id)}&limit=100`
        );
        const historyPayload = await historyResponse.json();
        setRelatedEvents(historyPayload.data || []);
      } catch (err) {
        console.error(err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    loadEvent();
  }, [id]);

  if (error) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <h1 className="page-title">Event Details</h1>
        </header>

        <section className="page-section">
          <ErrorMessage message={error} onRetry={() => window.location.reload()} />
        </section>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <h1 className="page-title">Event Details</h1>
        </header>

        <section className="page-section">
          <div className="section-label">Event Header</div>
          <Skeleton height="76px" />
        </section>

        <section className="page-section">
          <div className="section-label">Details</div>
          <div className={styles.detailPanels}>
            <Skeleton height="320px" />
            <Skeleton height="320px" />
          </div>
        </section>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <h1 className="page-title">Event Details</h1>
        </header>

        <section className="page-section">
          <div className={styles.detailPanel}>
            <h2 className={styles.detailPanelTitle}>Event not found</h2>
            <p className={styles.detailPanelCopy}>
              The selected event is not available in the gateway data store.
            </p>
            <button
              type="button"
              className="primary-button primary-button--inline"
              onClick={() => navigate("/history")}
            >
              Back to Historical Events
            </button>
          </div>
        </section>
      </div>
    );
  }

  const endTime = new Date(event.last_sample_timestamp);
  const startTime =
    event.duration && !Number.isNaN(Number(event.duration))
      ? new Date(endTime.getTime() - Number(event.duration) * 1000)
      : endTime;
  const previousEvent = relatedEvents.find(
    (candidate) => candidate.event_id !== event.event_id
  );

  return (
    <div className="page-shell">
      <header className="page-header">
        <h1 className="page-title">Event Details</h1>
      </header>

      <section className="page-section">
        <div className="section-label">Event Header</div>

        <div className={styles.eventHeaderCard}>
          <div className={styles.eventHeaderInfo}>
            <div className={dataListItemStyles.dataListLabel}>Event ID</div>
            <div className={dataListItemStyles.dataListValue} title={event.event_id}>
              {formatEventDisplayId(event.event_id)}
            </div>
          </div>

          <StatusBadge type={event.event_type} />

          <div className={styles.eventHeaderInfo}>
            <div>Start {formatUtcTimestamp(startTime)}</div>
            <div>End {formatUtcTimestamp(endTime)}</div>
          </div>

          <button
            type="button"
            className="primary-button primary-button--inline"
            onClick={() => navigate("/history")}
          >
            Back to Historical Events
          </button>
        </div>
      </section>

      <section className="page-section">
        <div className="section-label">Details</div>

        <div className={styles.detailPanels}>
          <article className={styles.detailPanel}>
            <h2 className={styles.detailPanelTitle}>Event Data</h2>

            <div className={dataListItemStyles.dataList}>
              <DataListItem
                label="Classification"
                value={eventTypeLabel(event.event_type)}
                isDetail
              />
              <DataListItem
                label="Dominant Frequency"
                value={formatFrequency(event.peak_frequency)}
                isDetail
              />
              <DataListItem
                label="Peak Amplitude"
                value={formatAmplitude(event.peak_amplitude, event.measurement_unit)}
                isDetail
              />
            </div>
          </article>

          <article className={styles.detailPanel}>
            <h2 className={styles.detailPanelTitle}>Sensor Data</h2>

            <div className={styles.detailGrid}>
              <DataListItem
                label="Sensor ID"
                value={sensorDisplayId(event.sensor_id)}
                isDetail
              />
              <DataListItem
                label="Sensor History"
                value={`${relatedEvents.length} stored events`}
                isDetail
              />
              <DataListItem
                label="Category"
                value={categoryName(event.category)}
                isDetail
              />
              <DataListItem
                label="Last Sensor Event"
                value={formatEventDisplayId(event.event_id)}
                valueTitle={event.event_id}
                isDetail
              />
              <DataListItem
                label="Region"
                value={event.region}
                isDetail
              />
              <DataListItem
                label="Previous Event"
                value={
                  previousEvent?.event_id
                    ? formatEventDisplayId(previousEvent.event_id)
                    : "N/A"
                }
                valueTitle={previousEvent?.event_id || undefined}
                isDetail
              />
              <DataListItem
                label="Coordinates"
                value={formatCoordinates(event.latitude, event.longitude)}
                isDetail
              />
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
