/**
 * DST-boundary tests for the shared time module — the modular contract that
 * stops the "9am booked at 10am" bug from coming back.
 *
 * The bug: in BST, a wall-clock "09:00" got stored as 09:00 UTC = 10:00 BST.
 * In GMT (winter) the same code accidentally works, so QA in November won't
 * catch it. These tests exercise both sides AND the spring/autumn switchover
 * Sundays so a future refactor that subtly breaks tz handling fails here.
 *
 * UK 2026 DST: clocks spring forward 2026-03-29, fall back 2026-10-25.
 */

import { describe, expect, it } from "vitest";
import { formatLocal, getLocalDateTime, toUtcIso } from "../../../supabase/functions/_shared/clock.ts";

describe("toUtcIso — local wall-clock → UTC ISO (DST-safe)", () => {
  it("BST (summer): 09:00 in London is 08:00 UTC", () => {
    // Inside BST window
    expect(toUtcIso("2026-05-26", "09:00", "Europe/London")).toBe("2026-05-26T08:00:00.000Z");
    expect(toUtcIso("2026-07-15", "14:30", "Europe/London")).toBe("2026-07-15T13:30:00.000Z");
  });

  it("GMT (winter): 09:00 in London IS 09:00 UTC", () => {
    expect(toUtcIso("2026-01-15", "09:00", "Europe/London")).toBe("2026-01-15T09:00:00.000Z");
    expect(toUtcIso("2026-12-01", "17:00", "Europe/London")).toBe("2026-12-01T17:00:00.000Z");
  });

  it("spring DST: the morning after the switch is BST (clocks went forward 2026-03-29)", () => {
    // 2026-03-30 is a Monday — first full weekday of BST
    expect(toUtcIso("2026-03-30", "09:00", "Europe/London")).toBe("2026-03-30T08:00:00.000Z");
  });

  it("autumn DST: the morning after the fall-back is GMT (clocks went back 2026-10-25)", () => {
    // 2026-10-26 is a Monday — first full weekday of GMT
    expect(toUtcIso("2026-10-26", "09:00", "Europe/London")).toBe("2026-10-26T09:00:00.000Z");
  });

  it("non-UK timezone: New York 09:00 EDT = 13:00 UTC", () => {
    expect(toUtcIso("2026-05-26", "09:00", "America/New_York")).toBe("2026-05-26T13:00:00.000Z");
  });

  it("accepts seconds in the time string", () => {
    expect(toUtcIso("2026-05-26", "09:30:45", "Europe/London")).toBe("2026-05-26T08:30:45.000Z");
  });
});

describe("formatLocal — UTC ISO → local wall-clock", () => {
  it("BST: a 08:00 UTC instant is 09:00 in London", () => {
    expect(formatLocal("2026-05-26T08:00:00Z", "Europe/London")).toEqual({
      date: "2026-05-26", time: "09:00", display: "2026-05-26 09:00",
    });
  });
  it("GMT: a 09:00 UTC instant is 09:00 in London", () => {
    expect(formatLocal("2026-01-15T09:00:00Z", "Europe/London")).toEqual({
      date: "2026-01-15", time: "09:00", display: "2026-01-15 09:00",
    });
  });
});

describe("round-trip: write → read in the same tz returns what we put in", () => {
  it("BST 09:00 → store as UTC → read back as 09:00 London", () => {
    const utc = toUtcIso("2026-05-26", "09:00", "Europe/London");
    expect(formatLocal(utc, "Europe/London")).toEqual({
      date: "2026-05-26", time: "09:00", display: "2026-05-26 09:00",
    });
  });
  it("GMT 14:30 → store as UTC → read back as 14:30 London", () => {
    const utc = toUtcIso("2026-12-01", "14:30", "Europe/London");
    expect(formatLocal(utc, "Europe/London")).toEqual({
      date: "2026-12-01", time: "14:30", display: "2026-12-01 14:30",
    });
  });
});

describe("getLocalDateTime — current time in a tz", () => {
  it("returns the same instant in different tz shapes", () => {
    const lon = getLocalDateTime("Europe/London");
    const ny = getLocalDateTime("America/New_York");
    // Both describe NOW — date_iso may differ across midnight but the
    // structure must be present and well-formed.
    expect(lon.date_iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(lon.time_24h).toMatch(/^\d{2}:\d{2}$/);
    expect(ny.date_iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(["GMT", "BST"]).toContain(lon.timezone);
  });
});
