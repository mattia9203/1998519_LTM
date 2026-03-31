import { render, screen } from "@testing-library/react";

jest.mock(
  "react-router-dom",
  () => {
    const React = require("react");

    return {
      Link: ({ children, to, className }) =>
        React.createElement("a", { href: to, className }, children),
      useLocation: jest.fn(),
    };
  },
  { virtual: true }
);

import { useLocation } from "react-router-dom";
import Layout from "./components/Layout";

const mockUseLocation = useLocation;

describe("Layout", () => {
  beforeEach(() => {
    mockUseLocation.mockReset();
  });

  test("does not show the Event Details nav item outside the details route", () => {
    mockUseLocation.mockReturnValue({ pathname: "/history" });

    render(
      <Layout>
        <div>History page</div>
      </Layout>
    );

    expect(screen.queryByText("Event Details")).not.toBeInTheDocument();
  });

  test("shows the Event Details nav item on the details route", () => {
    mockUseLocation.mockReturnValue({ pathname: "/event/event-1234567890" });

    render(
      <Layout>
        <div>Event page</div>
      </Layout>
    );

    expect(screen.getByText("Event Details")).toBeInTheDocument();
  });
});
