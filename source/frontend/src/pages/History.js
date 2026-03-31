import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API_BASE, LIVE_WS_URL } from "../config";
import {
  EVENT_TYPE_OPTIONS,
  buildHistorySearch,
  eventTypeBadge,
  eventTypePillClass,
  formatAmplitude,
  formatFrequency,
  formatCompactTimestamp,
  matchesHistoryFilters,
  sensorDisplayId,
} from "../utils/platform";

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
        const payload = await response.json();
        setEvents(payload.data || []);
      } catch (error) {
        console.error(error);
      }
    };

    loadHistory();
  }, [appliedFilters]);

  useEffect(() => {
    const socket = new WebSocket(LIVE_WS_URL);

    socket.onmessage = (message) => {
      const incomingEvent = JSON.parse(message.data);

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

  const visibleEvents = events.filter((event) =>
    matchesHistoryFilters(event, appliedFilters)
  );

  const regionOptions = [...new Set(sensors.map((sensor) => sensor.region))].sort();

  return (
    <div className="page-shell">
      <header className="page-header">
        <h1 className="page-title">Historical Events</h1>
      </header>

      <section className="page-section">
        <div className="section-label">Filters</div>

        <div className="filters-shell">
          <div className="filter-grid">
            <label
              className={`filter-control${draftFilters.event_type ? " is-active" : ""}`}
            >
              <span className="filter-control__label">Event Type</span>
              <select
                className="filter-control__input"
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
            </label>

            <label
              className={`filter-control${draftFilters.sensor_id ? " is-active" : ""}`}
            >
              <span className="filter-control__label">Sensor</span>
              <select
                className="filter-control__input"
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
            </label>

            <label
              className={`filter-control${draftFilters.region ? " is-active" : ""}`}
            >
              <span className="filter-control__label">Region</span>
              <select
                className="filter-control__input"
                value={draftFilters.region}
                onChange={(event) => handleDraftChange("region", event.target.value)}
              >
                <option value="">All regions</option>
                {regionOptions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </label>

            <label
              className={`filter-control${draftFilters.minAmplitude ? " is-active" : ""}`}
            >
              <span className="filter-control__label">Peak Amp. Min</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className="filter-control__input"
                value={draftFilters.minAmplitude}
                placeholder="3.0 mm/s"
                onChange={(event) =>
                  handleDraftChange("minAmplitude", event.target.value)
                }
              />
            </label>

            <button type="button" className="primary-button" onClick={applyFilters}>
              Filter
            </button>
          </div>
        </div>
      </section>

      <section className="page-section">
        <div className="section-label">Event Log</div>

        <div className="table-shell table-shell--scrollable">
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
                    <span
                      className={`pill ${eventTypePillClass(event.event_type)}`}
                    >
                      {eventTypeBadge(event.event_type)}
                    </span>
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
      </section>
    </div>
  );
}
