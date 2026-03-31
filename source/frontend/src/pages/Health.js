import React, { useContext } from "react";
import { HealthContext } from "../App";
import { formatCompactTimestamp } from "../utils/platform";

export default function Health() {
  // Leggiamo i dati in tempo reale dal Context globale
  const { summary, replicaRows, healthEvents } = useContext(HealthContext);

  if (!summary) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <h1 className="page-title">System Health</h1>
        </header>
      </div>
    );
  }

  const totalReplicas = summary.configured_replicas.length;
  const healthyReplicas = summary.active_list.length;
  const unavailableReplicas = summary.dead_list.length;
  const liveData = healthyReplicas > 0 ? "Active" : "Unavailable";

  return (
    <div className="page-shell">
      <header className="page-header page-header--split">
        <div>
          <h1 className="page-title">System Health</h1>
        </div>
        <span className="pill">ADMIN</span>
      </header>

      <section className="page-section">
        <div className="section-label">Summary</div>

        <div className="summary-grid">
          <div className="summary-card">
            <div className="summary-card__label">Total Replicas</div>
            <div className="summary-card__value">{totalReplicas}</div>
          </div>

          <div className="summary-card">
            <div className="summary-card__label">Healthy</div>
            <div className="summary-card__value">{healthyReplicas}</div>
          </div>

          <div className="summary-card">
            <div className="summary-card__label">Unavailable</div>
            <div className="summary-card__value">{unavailableReplicas}</div>
          </div>

          <div className="summary-card">
            <div className="summary-card__label">Live Data</div>
            <div 
              className="summary-card__value" 
              style={{ color: liveData === "Active" ? "#00e676" : "#ff4444" }}
            >
              {liveData}
            </div>
          </div>
        </div>
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
                    <span className="pill">
                      {row.status === "healthy" ? "HEALTHY" : "UNAVAILABLE"}
                    </span>
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

      <section className="page-section">
        <div className="section-label">Health Events</div>

        <div className="health-log">
          {healthEvents.length ? (
            healthEvents.map((entry) => (
              <div key={entry} className="health-log__entry">
                {entry}
              </div>
            ))
          ) : (
            <div className="health-log__entry">
              Live monitoring active. Waiting for replica state changes.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}