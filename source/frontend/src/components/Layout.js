import React from "react";
import { Link, useLocation } from "react-router-dom";

const navItems = [
  { to: "/sensors", label: "Sensors" },
  { to: "/history", label: "Historical Events" },
  { to: "/health", label: "System Health" },
];

export default function Layout({ children }) {
  const location = useLocation();
  const isEventPage = location.pathname.startsWith("/event/");

  return (
    <div className="app-shell">
      <aside className="platform-sidebar">
        <div className="platform-brand">Seismic Platform</div>

        <nav className="platform-nav" aria-label="Primary navigation">
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.to);

            return (
              <Link
                key={item.to}
                to={item.to}
                className={`platform-nav__link${isActive ? " is-active" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}

          {isEventPage && (
            <div
              className="platform-nav__link platform-nav__link--static is-active"
              aria-current="page"
            >
              Event Details
            </div>
          )}
        </nav>
      </aside>

      <main className="platform-content">{children}</main>
    </div>
  );
}
