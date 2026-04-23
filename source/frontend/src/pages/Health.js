import React, { useContext } from "react";
import { HealthContext } from "../App";
import { formatCompactTimestamp } from "../utils/platform";
import SummaryGrid from "../components/ui/SummaryGrid";
import SummaryCard from "../components/ui/SummaryCard";
import StatusBadge from "../components/ui/StatusBadge";
import Skeleton from "../components/ui/Skeleton";
import ErrorMessage from "../components/ui/ErrorMessage";
import styles from "./Health.module.css";

export default function Health() {
  // Leggiamo i dati in tempo reale dal Context globale
  const { summary, replicaRows, healthEvents, error } = useContext(HealthContext);

  if (error) {
    return (
      <div className="page-shell">
        <header className="page-header page-header--split">
          <div><h1 className="page-title">System Health</h1></div>
          <StatusBadge label="ADMIN" />
        </header>
        <section className="page-section">
          <ErrorMessage message={error} />
        </section>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="page-shell">
        <header className="page-header page-header--split">
          <div><h1 className="page-title">System Health</h1></div>
          <StatusBadge label="ADMIN" />
        </header>
        <section className="page-section">
          <div className="section-label">Summary</div>
          <SummaryGrid>
            <Skeleton height="104px" />
            <Skeleton height="104px" />
            <Skeleton height="104px" />
            <Skeleton height="104px" />
          </SummaryGrid>
        </section>
        <section className="page-section">
          <div className="section-label">Replica Status</div>
          <Skeleton height="200px" />
        </section>
      </div>
    );
  }

  const totalReplicas = summary.configured_replicas.length;
  const healthyReplicas = summary.active_list.length;
  const unavailableReplicas = summary.dead_list.length;
  const liveData = healthyReplicas > 0 ? "Active" : "Unavailable";

  return (
    <div className="page-shell" style={{ height: "calc(100vh - 66px)", overflow: "hidden" }}>
      <header className="page-header page-header--split">
        <div>
          <h1 className="page-title">System Health</h1>
        </div>
        <StatusBadge label="ADMIN" />
      </header>

      <section className="page-section">
        <div className="section-label">Summary</div>

        <SummaryGrid>
          <SummaryCard label="Total Replicas" value={totalReplicas} />
          <SummaryCard label="Healthy" value={healthyReplicas} />
          <SummaryCard label="Unavailable" value={unavailableReplicas} />
          <SummaryCard
            label="Live Data"
            value={liveData}
            isAccent
            accentColor={liveData === "Active" ? "#00e676" : "#ff4444"}
          />
        </SummaryGrid>
      </section>

      <section className="page-section">
        <div className="section-label">Replica Status</div>

        <div className="table-shell">
          <table className="platform-table">
            <thead>
              <tr>
                <th>Replica ID</th>
                <th>Status</th>
                <th>Last Heartbeat</th>
                <th>Unavailable Since</th>
              </tr>
            </thead>
            <tbody>
              {replicaRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>
                    <StatusBadge
                      label={row.status === "healthy" ? "HEALTHY" : "UNAVAILABLE"}
                    />
                  </td>
                  <td>
                    {row.lastHeartbeat
                      ? formatCompactTimestamp(row.lastHeartbeat)
                      : "-"}
                  </td>
                  <td>
                    {row.unavailableSince
                      ? formatCompactTimestamp(row.unavailableSince)
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="page-section" style={{ flex: 1, minHeight: 0 }}>
        <div className="section-label">Component Status</div>
        <div className={styles.healthLog} style={{ height: "100%" }}>
          {healthEvents.length ? (
            healthEvents.map((entry) => (
              <div key={entry} className={styles.healthLogEntry}>
                {entry}
              </div>
            ))
          ) : (
            <div className={styles.healthLogEntry}>
              Live monitoring active. Waiting for replica state changes.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}