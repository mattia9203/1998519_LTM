import React, { createContext, useEffect, useRef, useState, useMemo } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Sensors from './pages/Sensors';
import History from './pages/History';
import EventDetail from './pages/EventDetail';
import Health from './pages/Health';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import { API_BASE } from './config';
import { formatCompactTimestamp, replicaLabel } from './utils/platform';
import './global.css';

// 1. Creiamo un Context globale per la salute del sistema
export const HealthContext = createContext();

// 2. Creiamo il Provider che farà il polling continuo in background
function HealthProvider({ children }) {
  const replicaStateRef = useRef({});
  const [summary, setSummary] = useState(null);
  const [replicaRows, setReplicaRows] = useState([]);
  const [healthEvents, setHealthEvents] = useState(() => {
    const saved = sessionStorage.getItem("healthEvents");
    return saved ? JSON.parse(saved) : [];
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch(`${API_BASE}/system/status`);
        if (!response.ok) throw new Error("Endpoint returned an error");
        const payload = await response.json();
        const receivedAt = new Date().toISOString();
        const nextReplicaState = {};
        const nextRows = payload.configured_replicas.map((replicaUrl, index) => {
          const isHealthy = payload.active_list.includes(replicaUrl);
          const previous = replicaStateRef.current[replicaUrl];
          const nextStatus = isHealthy ? "healthy" : "unavailable";
          const lastHeartbeat = isHealthy ? receivedAt : previous?.lastHeartbeat || null;
          const unavailableSince = isHealthy ? null : previous?.unavailableSince || receivedAt;

          nextReplicaState[replicaUrl] = { status: nextStatus, lastHeartbeat, unavailableSince };
          return { id: replicaLabel(replicaUrl, index), status: nextStatus, lastHeartbeat, unavailableSince };
        });

        const nextEvents = [];
        payload.configured_replicas.forEach((replicaUrl, index) => {
          const previous = replicaStateRef.current[replicaUrl];
          const current = nextReplicaState[replicaUrl];
          if (!previous || previous.status === current.status) return;

          const label = replicaLabel(replicaUrl, index);
          if (current.status === "unavailable") {
            nextEvents.unshift(`${formatCompactTimestamp(receivedAt)} UTC | ${label} heartbeat lost`);
            nextEvents.unshift(`${formatCompactTimestamp(receivedAt)} UTC | ${label} marked unavailable`);
          } else {
            nextEvents.unshift(`${formatCompactTimestamp(receivedAt)} UTC | ${label} joined cluster`);
          }
        });

        replicaStateRef.current = nextReplicaState;
        setSummary(payload);
        setReplicaRows(nextRows);

        if (nextEvents.length) {
          setHealthEvents((current) => {
            const updatedEvents = [...nextEvents, ...current].slice(0, 6);
            sessionStorage.setItem("healthEvents", JSON.stringify(updatedEvents));
            return updatedEvents;
          });
        }
        setError(null);
      } catch (err) {
        console.error("Global Health Poll Error:", err);
        setError(err.message);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  const contextValue = useMemo(
    () => ({ summary, replicaRows, healthEvents, error }),
    [summary, replicaRows, healthEvents, error]
  );

  return (
    <HealthContext.Provider value={contextValue}>
      {children}
    </HealthContext.Provider>
  );
}

function App() {
  return (
    <GlobalErrorBoundary>
      <HealthProvider>
        <Router>
          <Layout>
            <Routes>
              <Route path="/" element={<Navigate to="/sensors" />} />
              <Route path="/sensors" element={<Sensors />} />
              <Route path="/history" element={<History />} />
              <Route path="/event/:id" element={<EventDetail />} />
              <Route path="/health" element={<Health />} />
            </Routes>
          </Layout>
        </Router>
      </HealthProvider>
    </GlobalErrorBoundary>
  );
}

export default App;