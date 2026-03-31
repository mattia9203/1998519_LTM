import { formatEventDisplayId } from "./platform";

describe("formatEventDisplayId", () => {
  test("truncates event IDs to the first 10 characters", () => {
    expect(formatEventDisplayId("1234567890abcdef")).toBe("1234567890");
  });

  test("keeps shorter event IDs unchanged", () => {
    expect(formatEventDisplayId("event-42")).toBe("event-42");
  });
});
