import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_BASE } from "../config";
import {
  categoryName,
  eventTypeBadge,
  eventTypeLabel,
  formatAmplitude,
  formatCoordinates,
  formatEventDisplayId,
  formatFrequency,
  formatUtcTimestamp,
  sensorDisplayId,
} from "../utils/platform";

export default function EventDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [isLoading, setIsLoading] = useState(true);
  const [event, setEvent] = useState(null);
  const [relatedEvents, setRelatedEvents] = useState([]);

  useEffect(() => {
    const loadEvent = async () => {
      setIsLoading(true);

      try {
        const response = await fetch(`${API_BASE}/events/${encodeURIComponent(id)}`);
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
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };

    loadEvent();
  }, [id]);

  if (isLoading) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <h1 className="page-title">Event Details</h1>
        </header>

        <section className="page-section">
          <div className="detail-panel">
            <h2 className="detail-panel__title">Loading event</h2>
            <p className="detail-panel__copy">
              Fetching the event payload from the gateway.
            </p>
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
          <div className="detail-panel">
            <h2 className="detail-panel__title">Event not found</h2>
            <p className="detail-panel__copy">
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

        <div className="event-header-card">
          <div className="event-header-card__identity">
            <div className="data-list__label">Event ID</div>
            <div className="event-header-card__event-id" title={event.event_id}>
              {formatEventDisplayId(event.event_id)}
            </div>
          </div>

          <span className="pill">{eventTypeBadge(event.event_type)}</span>

          <div className="event-header-card__timing">
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

        <div className="detail-panels">
          <article className="detail-panel">
            <h2 className="detail-panel__title">Event Data</h2>

            <div className="detail-list">
              <div className="detail-list__item">
                <span className="detail-list__label">Classification</span>
                <span className="detail-list__value">
                  {eventTypeLabel(event.event_type)}
                </span>
              </div>

              <div className="detail-list__item">
                <span className="detail-list__label">Dominant Frequency</span>
                <span className="detail-list__value">
                  {formatFrequency(event.peak_frequency)}
                </span>
              </div>

              <div className="detail-list__item">
                <span className="detail-list__label">Peak Amplitude</span>
                <span className="detail-list__value">
                  {formatAmplitude(event.peak_amplitude, event.measurement_unit)}
                </span>
              </div>
            </div>
          </article>

          <article className="detail-panel">
            <h2 className="detail-panel__title">Sensor Data</h2>

            <div className="detail-grid">
              <div className="detail-list__item">
                <span className="detail-list__label">Sensor ID</span>
                <span className="detail-list__value">
                  {sensorDisplayId(event.sensor_id)}
                </span>
              </div>

              <div className="detail-list__item">
                <span className="detail-list__label">Sensor History</span>
                <span className="detail-list__value">
                  {relatedEvents.length} stored events
                </span>
              </div>

              <div className="detail-list__item">
                <span className="detail-list__label">Category</span>
                <span className="detail-list__value">
                  {categoryName(event.category)}
                </span>
              </div>

              <div className="detail-list__item">
                <span className="detail-list__label">Last Sensor Event</span>
                <span className="detail-list__value" title={event.event_id}>
                  {formatEventDisplayId(event.event_id)}
                </span>
              </div>

              <div className="detail-list__item">
                <span className="detail-list__label">Region</span>
                <span className="detail-list__value">{event.region}</span>
              </div>

              <div className="detail-list__item">
                <span className="detail-list__label">Previous Event</span>
                <span
                  className="detail-list__value"
                  title={previousEvent?.event_id || undefined}
                >
                  {previousEvent?.event_id
                    ? formatEventDisplayId(previousEvent.event_id)
                    : "N/A"}
                </span>
              </div>

              <div className="detail-list__item">
                <span className="detail-list__label">Coordinates</span>
                <span className="detail-list__value">
                  {formatCoordinates(event.latitude, event.longitude)}
                </span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
