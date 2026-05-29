/**
 * Shared clock + timezone utility — ONE place all tools/channels go through
 * for anything date/time-shaped. Two halves:
 *
 *   READ side  — getLocalDateTime(tz): what's "today" / "now" in the
 *                practice's timezone? Agent talks to patients in local time.
 *   WRITE side — toUtcIso(date, time, tz): convert the local wall-clock the
 *                patient agreed on (e.g. "Tuesday 9am" in BST) to a proper
 *                UTC ISO with offset, so the DB stores the right instant.
 *
 * Why it matters: PostgreSQL timestamptz ingesting a NAIVE "2026-05-26T09:00:00"
 * treats it as UTC — which is 10:00 in London during BST. Bookings then sit
 * one hour late from late March to late October, and the bug hides in winter
 * (GMT=UTC). Always go through toUtcIso when writing; always go through
 * getLocalDateTime / formatLocal when displaying or speaking.
 *
 * IANA TZ name (e.g. "Europe/London") — never a fixed offset — so DST is
 * handled automatically by the platform's tz database.
 */

export interface UKDateTime {
  /** e.g. "Thursday" */
  day_of_week: string;
  /** e.g. "12 March 2026" */
  date_display: string;
  /** e.g. "2026-03-12" */
  date_iso: string;
  /** e.g. "15:30" */
  time_24h: string;
  /** e.g. "3:30 PM" */
  time_12h: string;
  /** "GMT" or "BST" */
  timezone: string;
  /** Human-readable string for the AI agent */
  summary: string;
}

export const DEFAULT_TZ = "Europe/London";

/** Read side: current date/time in the practice's timezone, in shapes the
 *  agent and tools both want. Pass an IANA tz (e.g. "Europe/London"); falls
 *  back to Europe/London so legacy callers keep working. */
export function getLocalDateTime(tz: string = DEFAULT_TZ): UKDateTime {
  const now = new Date();

  const day_of_week = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(now);
  const date_display = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, day: "numeric", month: "long", year: "numeric",
  }).format(now);

  const isoParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const dd = isoParts.find((p) => p.type === "day")?.value || "";
  const mm = isoParts.find((p) => p.type === "month")?.value || "";
  const yyyy = isoParts.find((p) => p.type === "year")?.value || "";
  const date_iso = `${yyyy}-${mm}-${dd}`;

  const time_24h = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
  const time_12h = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(now);

  const tzPart = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, timeZoneName: "short",
  }).formatToParts(now).find((p) => p.type === "timeZoneName");
  const timezone = tzPart?.value || "GMT";

  const summary = `Today is ${day_of_week} ${date_display}. The current time is ${time_24h} ${timezone}.`;
  return { day_of_week, date_display, date_iso, time_24h, time_12h, timezone, summary };
}

/** Back-compat alias — older callers used getUKDateTime() with no args. */
export const getUKDateTime = () => getLocalDateTime(DEFAULT_TZ);

/** Returns the tz offset (minutes east of UTC) for an instant in a tz.
 *  E.g. for an instant during BST in Europe/London → +60. During GMT → 0.
 *  DST-safe because it asks Intl for what the wall-clock looked like there. */
function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  // Intl returns "24" for midnight in some locales — normalise to "00".
  const hr = parts.hour === "24" ? "00" : parts.hour;
  const wallAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +hr, +parts.minute, +parts.second);
  return (wallAsUtc - instant.getTime()) / 60_000;
}

/** WRITE side: given a wall-clock date+time the patient agreed on (e.g.
 *  "2026-05-26" + "09:00") in the practice's timezone, return the UTC ISO
 *  string to store. DST-safe: in BST returns "...T08:00:00.000Z"; in GMT
 *  returns "...T09:00:00.000Z". Always go through this before writing a
 *  timestamptz column — never concatenate a naive ISO. */
export function toUtcIso(date: string, time: string, tz: string = DEFAULT_TZ): string {
  // Approximate UTC by reading the wall-clock as if it were UTC, then
  // subtract the tz offset *at that instant* (so the autumn DST fallback
  // ambiguity resolves to the standard-time interpretation, which matches
  // what UK clinics intuitively mean when they say "9am").
  const t = time.length === 5 ? `${time}:00` : time;
  const approx = new Date(`${date}T${t}Z`);
  const offsetMin = tzOffsetMinutes(approx, tz);
  return new Date(approx.getTime() - offsetMin * 60_000).toISOString();
}

/** Display helper: format a UTC instant in the practice's local time. */
export function formatLocal(utcIso: string, tz: string = DEFAULT_TZ): { date: string; time: string; display: string } {
  const d = new Date(utcIso);
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d).split("/").reverse().join("-"); // dd/mm/yyyy → yyyy-mm-dd
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return { date, time, display: `${date} ${time}` };
}
