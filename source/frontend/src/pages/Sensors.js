import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE, LIVE_WS_URL } from "../config";
import SummaryGrid from "../components/ui/SummaryGrid";
import SummaryCard from "../components/ui/SummaryCard";
import SensorCard from "../components/SensorCard";
import Skeleton from "../components/ui/Skeleton";
import ErrorMessage from "../components/ui/ErrorMessage";
import StatusBadge from "../components/ui/StatusBadge";
import styles from "../components/SensorCard.module.css";

const categoryRank = {
  field: 0,
  datacenter: 1,
};

export default function Sensors() {
  const navigate = useNavigate();
  const [sensors, setSensors] = useState([]);
  const [latestEvents, setLatestEvents] = useState({});
  const [systemStatus, setSystemStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [wsOffline, setWsOffline] = useState(false);

  const loadDashboard = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [sensorsResponse, historyResponse, healthResponse] =
        await Promise.all([
          fetch(`${API_BASE}/sensors`),
          fetch(`${API_BASE}/history?limit=120`),
          fetch(`${API_BASE}/system/status`),
        ]);

      if (!sensorsResponse.ok || !historyResponse.ok) {
        throw new Error("Impossibile recuperare i dati dei sensori o storici.");
      }

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
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  // Initialize WebSocket connection to update latest events in real-time
  useEffect(() => {
    const socket = new WebSocket(LIVE_WS_URL);

    socket.onmessage = (message) => {
      const incomingEvent = JSON.parse(message.data);
      setWsOffline(false);

      setLatestEvents((currentLatest) => ({
        ...currentLatest,
        [incomingEvent.sensor_id]: incomingEvent,
      }));
    };

    socket.onerror = () => setWsOffline(true);
    socket.onclose = () => setWsOffline(true);

    // Clean up the socket connection on component unmount
    return () => socket.close();
  }, []);

  const orderedSensors = useMemo(() => {
    return [...sensors].sort((left, right) => {
      const rankDelta =
        (categoryRank[left.category] ?? 99) - (categoryRank[right.category] ?? 99);

      if (rankDelta !== 0) {
        return rankDelta;
      }

      return left.sensor_id.localeCompare(right.sensor_id);
    });
  }, [sensors]);

  const { totalSensors, fieldSensors, datacenterSensors } = useMemo(() => {
    return {
      totalSensors: orderedSensors.length,
      fieldSensors: orderedSensors.filter((sensor) => sensor.category === "field").length,
      datacenterSensors: orderedSensors.filter((sensor) => sensor.category === "datacenter").length,
    };
  }, [orderedSensors]);
  const liveMonitoring =
    systemStatus?.status === "operational" ? "Active" : "Degraded";

  if (error) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <h1 className="page-title">Sensors</h1>
        </header>
        <section className="page-section">
          <ErrorMessage
            message={error}
            onRetry={loadDashboard}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="page-header page-header--split">
        <div>
          <h1 className="page-title">Sensors</h1>
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
        <div className="section-label">Summary</div>

        {isLoading ? (
          <SummaryGrid>
            <Skeleton height="104px" />
            <Skeleton height="104px" />
            <Skeleton height="104px" />
            <Skeleton height="104px" />
          </SummaryGrid>
        ) : (
          <SummaryGrid>
            <SummaryCard label="Total Sensors" value={totalSensors} />
            <SummaryCard label="Field Sensors" value={fieldSensors} />
            <SummaryCard label="Datacenter Sensors" value={datacenterSensors} />
            <SummaryCard
              label="Live Monitoring"
              value={liveMonitoring}
              isAccent
              accentColor={liveMonitoring === "Active" ? "#00e676" : "#ff4444"}
            />
          </SummaryGrid>
        )}
      </section>

      <section className="page-section">
        <div className="section-label">Sensor Cards</div>

        {isLoading ? (
          <div className={styles.sensorGrid}>
            <Skeleton height="232px" />
            <Skeleton height="232px" />
            <Skeleton height="232px" />
            <Skeleton height="232px" />
          </div>
        ) : (
          <div className={styles.sensorGrid}>
            {orderedSensors.map((sensor) => {
              const latestEvent = latestEvents[sensor.sensor_id];

              return (
                <SensorCard
                  key={sensor.sensor_id}
                  sensor={sensor}
                  latestEvent={latestEvent}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
