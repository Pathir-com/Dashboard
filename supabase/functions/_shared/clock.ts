/**
 * Shared UK clock utility.
 * Returns the current date/time in Europe/London timezone.
 * Used by all channel handlers (phone, chat, Meta, SMS) so the AI
 * agent always knows "what time is it" regardless of channel.
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

export function getUKDateTime(): UKDateTime {
  const now = new Date();

  const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long" });
  const day_of_week = dayFmt.format(now);

  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric",
  });
  const date_display = dateFmt.format(now);

  const isoFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const isoParts = isoFmt.formatToParts(now);
  const dd = isoParts.find((p) => p.type === "day")?.value || "";
  const mm = isoParts.find((p) => p.type === "month")?.value || "";
  const yyyy = isoParts.find((p) => p.type === "year")?.value || "";
  const date_iso = `${yyyy}-${mm}-${dd}`;

  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const time_24h = timeFmt.format(now);

  const time12Fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "numeric", minute: "2-digit", hour12: true,
  });
  const time_12h = time12Fmt.format(now);

  // Detect GMT vs BST
  const tzFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", timeZoneName: "short",
  });
  const tzPart = tzFmt.formatToParts(now).find((p) => p.type === "timeZoneName");
  const timezone = tzPart?.value || "GMT";

  const summary = `Today is ${day_of_week} ${date_display}. The current time is ${time_24h} ${timezone}.`;

  return { day_of_week, date_display, date_iso, time_24h, time_12h, timezone, summary };
}
