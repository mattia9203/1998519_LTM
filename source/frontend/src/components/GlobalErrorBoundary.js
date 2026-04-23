import React, { Component } from "react";

export default class GlobalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // You could also log the error to an error reporting service
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-shell" style={{ padding: "40px" }}>
          <header className="page-header">
            <h1 className="page-title">Fatal Error</h1>
          </header>
          <section className="page-section">
            <div className="detail-panel">
              <h2
                className="detail-panel__title"
                style={{ color: "var(--accent)" }}
              >
                App Crashed
              </h2>
              <p className="detail-panel__copy">
                {this.state.error?.message ||
                  "An unexpected error occurred in the front-end application."}
              </p>
              <button
                type="button"
                className="primary-button primary-button--inline"
                onClick={() => window.location.replace("/")}
              >
                Reload Dashboard
              </button>
            </div>
          </section>
        </div>
      );
    }
    return this.props.children;
  }
}
