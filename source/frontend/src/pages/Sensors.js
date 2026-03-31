import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE, LIVE_WS_URL } from "../config";
import {
  categoryLabel,
  formatCoordinates,
  formatFrequency,
  sensorDisplayId,
  eventTypeBadge,
  eventTypePillClass,
} from "../utils/platform";

const categoryRank = {
  field: 0,
  datacenter: 1,
};

export default function Sensors() {
  const navigate = useNavigate();
  const [sensors, setSensors] = useState([]);
  const [latestEvents, setLatestEvents] = useState({});
  const [systemStatus, setSystemStatus] = useState(null);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [sensorsResponse, historyResponse, healthResponse] =
          await Promise.all([
            fetch(`${API_BASE}/sensors`),
            fetch(`${API_BASE}/history?limit=120`),
            fetch(`${API_BASE}/system/status`),
          ]);

        const sensorsPayload = await sensorsResponse.json();
        const historyPayload = await historyResponse.json();
        const healthPayload = await healthResponse.json();

        const eventLookup = {};

        (historyPayload.data || []).forEach((event) => {
          if (!eventLookup[event.sensor_id]) {
            eventLookup[event.sensor_id] = event;
          }
        });

        setSensors(sensorsPayload.data || []);
        setLatestEvents(eventLookup);
        setSystemStatus(healthPayload);
      } catch (error) {
        console.error(error);
      }
    };

    loadDashboard();
  }, []);

  // Initialize WebSocket connection to update latest events in real-time
  useEffect(() => {
    const socket = new WebSocket(LIVE_WS_URL);

    socket.onmessage = (message) => {
      const incomingEvent = JSON.parse(message.data);

      setLatestEvents((currentLatest) => ({
        ...currentLatest,
        [incomingEvent.sensor_id]: incomingEvent,
      }));
    };

    // Clean up the socket connection on component unmount
    return () => socket.close();
  }, []);

  const orderedSensors = [...sensors].sort((left, right) => {
    const rankDelta =
      (categoryRank[left.category] ?? 99) - (categoryRank[right.category] ?? 99);

    if (rankDelta !== 0) {
      return rankDelta;
    }

    return left.sensor_id.localeCompare(right.sensor_id);
  });

  const totalSensors = orderedSensors.length;
  const fieldSensors = orderedSensors.filter(
    (sensor) => sensor.category === "field"
  ).length;
  const datacenterSensors = orderedSensors.filter(
    (sensor) => sensor.category === "datacenter"
  ).length;
  const liveMonitoring =
    systemStatus?.status === "operational" ? "Active" : "Degraded";

  return (
    <div className="page-shell">
      <header className="page-header">
        <h1 className="page-title">Sensors</h1>
      </header>

      <section className="page-section">
        <div className="section-label">Summary</div>

        <div className="summary-grid">
          <div className="summary-card">
            <div className="summary-card__label">Total Sensors</div>
            <div className="summary-card__value">{totalSensors}</div>
          </div>

          <div className="summary-card">
            <div className="summary-card__label">Field Sensors</div>
            <div className="summary-card__value">{fieldSensors}</div>
          </div>

          <div className="summary-card">
            <div className="summary-card__label">Datacenter Sensors</div>
            <div className="summary-card__value">{datacenterSensors}</div>
          </div>

          <div className="summary-card summary-card--accent">
            <div className="summary-card__label">Live Monitoring</div>
            <div 
              className="summary-card__value" 
              style={{ color: liveMonitoring === "Active" ? "#00e676" : "#ff4444" }}
            >
              {liveMonitoring}
            </div>
          </div>
        </div>
      </section>

      <section className="page-section">
        <div className="section-label">Sensor Cards</div>

        <div className="sensor-grid">
          {orderedSensors.map((sensor) => {
            const latestEvent = latestEvents[sensor.sensor_id];

            return (
              <article key={sensor.sensor_id} className="sensor-card">
                <div className="sensor-card__header">
                  <h2 className="sensor-card__title">
                    {sensorDisplayId(sensor.sensor_id)}
                  </h2>
                  <span className="pill">{categoryLabel(sensor.category)}</span>
                </div>

                <div className="data-list">
                  <div className="data-list__item">
                    <span className="data-list__label">Region</span>
                    <span className="data-list__value">{sensor.region}</span>
                  </div>

                  <div className="data-list__item">
                    <span className="data-list__label">Coordinates</span>
                    <span className="data-list__value">
                      {formatCoordinates(sensor.latitude, sensor.longitude)}
                    </span>
                  </div>

                  <div className="data-list__item">
                    <span className="data-list__label">Last Event</span>
                    <span className="data-list__value data-list__value--muted">
                      {latestEvent ? (
                        <span
                          className={`pill ${eventTypePillClass(
                            latestEvent.event_type
                          )}`}
                        >
                          {eventTypeBadge(latestEvent.event_type)}
                        </span>
                      ) : (
                        "No recent event"
                      )}
                    </span>
                  </div>

                  <div className="data-list__item">
                    <span className="data-list__label">Dom. Freq.</span>
                    <span className="data-list__value data-list__value--muted">
                      {latestEvent
                        ? formatFrequency(latestEvent.peak_frequency)
                        : "N/A"}
                    </span>
                  </div>
                </div>

                <div className="sensor-card__actions">
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
                      navigate(`/history?sensor_id=${encodeURIComponent(sensor.sensor_id)}`)
                    }
                  >
                    History
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
