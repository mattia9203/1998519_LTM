import React, { useEffect, useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API_BASE, LIVE_WS_URL } from "../config";
import {
  EVENT_TYPE_OPTIONS,
  buildHistorySearch,
  formatAmplitude,
  formatFrequency,
  formatCompactTimestamp,
  matchesHistoryFilters,
  sensorDisplayId,
} from "../utils/platform";
import StatusBadge from "../components/ui/StatusBadge";
import Skeleton from "../components/ui/Skeleton";
import ErrorMessage from "../components/ui/ErrorMessage";
import styles from "./History.module.css";

const getInitialFilters = (searchParams) => ({
  event_type: searchParams.get("event_type") || "",
  sensor_id: searchParams.get("sensor_id") || "",
  region: searchParams.get("region") || "",
  minAmplitude: searchParams.get("minAmplitude") || "",
});

export default function History() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilters = getInitialFilters(searchParams);

  const [events, setEvents] = useState([]);
  const [sensors, setSensors] = useState([]);
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [wsOffline, setWsOffline] = useState(false);

  useEffect(() => {
    const nextFilters = getInitialFilters(searchParams);
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
  }, [searchParams]);

  useEffect(() => {
    const loadSensors = async () => {
      try {
        const response = await fetch(`${API_BASE}/sensors`);
        const payload = await response.json();
        
        // Sort the sensors array alphanumerically by sensor_id in ascending order
        const sortedSensors = (payload.data || []).sort((a, b) => {
          return a.sensor_id.localeCompare(b.sensor_id);
        });
        
        setSensors(sortedSensors);
      } catch (error) {
        console.error(error);
      }
    };

    loadSensors();
  }, []);

  useEffect(() => {
    const loadHistory = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();

        if (appliedFilters.event_type) {
          params.set("event_type", appliedFilters.event_type);
        }

        if (appliedFilters.sensor_id) {
          params.set("sensor_id", appliedFilters.sensor_id);
        }

        if (appliedFilters.region) {
          params.set("region", appliedFilters.region);
        }

        params.set("limit", "100");

        const response = await fetch(`${API_BASE}/history?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Unable to fetch history data");
        }
        const payload = await response.json();
        setEvents(payload.data || []);
      } catch (err) {
        console.error(err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    loadHistory();
  }, [appliedFilters]);

  useEffect(() => {
    const socket = new WebSocket(LIVE_WS_URL);

    socket.onmessage = (message) => {
      const incomingEvent = JSON.parse(message.data);
      setWsOffline(false);

      setEvents((current) => {
        if (
          current.some((event) => event.event_id === incomingEvent.event_id) ||
          !matchesHistoryFilters(incomingEvent, appliedFilters)
        ) {
          return current;
        }

        return [incomingEvent, ...current];
      });
    };

    socket.onerror = () => setWsOffline(true);
    socket.onclose = () => setWsOffline(true);

    return () => socket.close();
  }, [appliedFilters]);

  const handleDraftChange = (name, value) => {
    setDraftFilters((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const applyFilters = () => {
    setAppliedFilters(draftFilters);
    setSearchParams(buildHistorySearch(draftFilters));
  };

  const visibleEvents = useMemo(() => {
    return events.filter((event) =>
      matchesHistoryFilters(event, appliedFilters)
    );
  }, [events, appliedFilters]);

  const regionOptions = useMemo(() => {
    return [...new Set(sensors.map((sensor) => sensor.region))].sort();
  }, [sensors]);

  if (error) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <h1 className="page-title">Historical Events</h1>
        </header>
        <section className="page-section">
          <ErrorMessage message={error} onRetry={() => window.location.reload()} />
        </section>
      </div>
    );
  }

  return (
    <div className="page-shell" style={{ height: "calc(100vh - 66px)", overflow: "hidden" }}>
      <header className="page-header page-header--split">
        <div>
          <h1 className="page-title">Historical Events</h1>
        </div>
        {wsOffline && (
          <StatusBadge
            type="event-earthquake" 
            label="Live Data Offline"
            customClass="pill--event-earthquake"
          />
        )}
      </header>

      <section className="page-section">
        <div className="section-label">Filters</div>

        <div className={styles.filtersShell}>
          <div className={styles.filterGrid}>
            <div className={styles.filterControl}>
              <label className={styles.filterControlLabel} htmlFor="event_type">
                Event Type
              </label>
              <select
                className={styles.filterControlSelect}
                value={draftFilters.event_type}
                onChange={(event) =>
                  handleDraftChange("event_type", event.target.value)
                }
              >
                {EVENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.filterControl}>
              <label className={styles.filterControlLabel} htmlFor="sensor_id">
                Sensor ID
              </label>
              <select
                className={styles.filterControlSelect}
                value={draftFilters.sensor_id}
                onChange={(event) =>
                  handleDraftChange("sensor_id", event.target.value)
                }
              >
                <option value="">All sensors</option>
                {sensors.map((sensor) => (
                  <option key={sensor.sensor_id} value={sensor.sensor_id}>
                    {sensorDisplayId(sensor.sensor_id)}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.filterControl}>
              <label className={styles.filterControlLabel} htmlFor="region">
                Region
              </label>
              <select
                className={styles.filterControlSelect}
                value={draftFilters.region}
                onChange={(event) =>
                  handleDraftChange("region", event.target.value)
                }
              >  <option value="">All regions</option>
                {regionOptions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.filterControl}>
              <label className={styles.filterControlLabel} htmlFor="minAmplitude">
                Min. Amplitude
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={styles.filterControlInput}
                value={draftFilters.minAmplitude}
                placeholder="3.0 mm/s"
                onChange={(event) =>
                  handleDraftChange("minAmplitude", event.target.value)
                }
              />
            </div>

            <button type="button" className="primary-button" onClick={applyFilters}>
              Filter
            </button>
          </div>
        </div>
      </section>

      <section className="page-section" style={{ flex: 1, minHeight: 0 }}>
        <div className="section-label">Event Log</div>

        {isLoading ? (
          <div className="table-shell" style={{ height: "100%" }}>
            <Skeleton height="100%" />
          </div>
        ) : (
          <div className="table-shell table-shell--scrollable" style={{ height: "100%", maxHeight: "none" }}>
            <table className="platform-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Classification</th>
                  <th>Sensor</th>
                  <th>Dominant Frequency</th>
                  <th>Peak Amplitude</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.map((event) => (
                  <tr key={event.event_id}>
                    <td>{formatCompactTimestamp(event.last_sample_timestamp)}</td>
                    <td>
                      <StatusBadge type={event.event_type} />
                    </td>
                    <td>{sensorDisplayId(event.sensor_id)}</td>
                    <td>{formatFrequency(event.peak_frequency)}</td>
                    <td>{formatAmplitude(event.peak_amplitude)}</td>
                    <td>
                      <button
                        type="button"
                        className="table-action"
                        onClick={() =>
                          navigate(`/event/${encodeURIComponent(event.event_id)}`)
                        }
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!visibleEvents.length && (
              <div className="empty-state">No events match the selected filters.</div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
