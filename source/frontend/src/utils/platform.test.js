import { eventTypePillClass, formatEventDisplayId } from "./platform";

describe("formatEventDisplayId", () => {
  test("truncates event IDs to the first 10 characters", () => {
    expect(formatEventDisplayId("1234567890abcdef")).toBe("1234567890");
  });

  test("keeps shorter event IDs unchanged", () => {
    expect(formatEventDisplayId("event-42")).toBe("event-42");
  });
});

describe("eventTypePillClass", () => {
  test("maps earthquake events to the red pill", () => {
    expect(eventTypePillClass("earthquake")).toBe("pill--event-earthquake");
  });

  test("maps conventional explosions to the yellow pill", () => {
    expect(eventTypePillClass("conventional_explosion")).toBe(
      "pill--event-explosion"
    );
  });

  test("maps nuclear-like events to the green pill", () => {
    expect(eventTypePillClass("nuclear_like")).toBe("pill--event-nuclear");
  });
});
