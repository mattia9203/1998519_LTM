import React from "react";
import { Link, useLocation, NavLink } from "react-router-dom";
import styles from "./Layout.module.css";

const navItems = [
  { to: "/sensors", label: "Sensors" },
  { to: "/history", label: "Historical Events" },
  { to: "/health", label: "System Health" },
];

export default function Layout({ children }) {
  const location = useLocation();
  const isEventPage = location.pathname.startsWith("/event/");

  return (
    <div className={styles.appShell}>
      <aside className={styles.platformSidebar}>
        <div className={styles.platformBrand}>Seismic Platform</div>

        <nav className={styles.platformNav} aria-label="Primary navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `${styles.platformNavLink}${isActive ? ` ${styles.platformNavLinkActive}` : ""}`
              }
            >
              {item.label}
            </NavLink>
          ))}

          {isEventPage && (
            <div
              className={`${styles.platformNavLink} ${styles.platformNavLinkStatic} ${styles.platformNavLinkActive}`}
              aria-current="page"
            >
              Event Details
            </div>
          )}
        </nav>
      </aside>

      <main className={styles.platformContent}>{children}</main>
    </div>
  );
}
