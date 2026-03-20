/**
 * Appointment slot finder — searches practitioner availability against existing bookings.
 * Single DB query for the entire search window, then in-memory slot generation.
 */

import { getUKDateTime } from "./clock.ts";
import { timeToMinutes } from "./practice-hours.ts";

// deno-lint-ignore no-explicit-any
type DB = any;

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// deno-lint-ignore no-explicit-any
export async function findSlots(db: DB, opts: any) {
  const { practitioners, practice_id, totalMinutes, preference_day, preference_time, preference_date, openingHours, holidayHours, searchDays } = opts;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // deno-lint-ignore no-explicit-any
  const slots: any[] = [];
  const clock = getUKDateTime();
  const todayISO = clock.date_iso;
  const todayDate = new Date(todayISO + "T12:00:00Z");

  // Single query for entire search window
  const startRange = new Date(todayDate.getTime() + 86400000).toISOString().slice(0, 10);
  const endRange = new Date(todayDate.getTime() + (searchDays + 1) * 86400000).toISOString().slice(0, 10);
  const { data: allExisting } = await db
    .from("appointments").select("practitioner_id, starts_at, ends_at")
    .eq("practice_id", practice_id)
    .gte("starts_at", `${startRange}T00:00:00`)
    .lt("starts_at", `${endRange}T00:00:00`)
    .neq("status", "cancelled");

  for (let d = 1; d <= searchDays; d++) {
    if (slots.length >= 12) break;

    const date = new Date(todayDate.getTime() + d * 86400000);
    const iso = date.toISOString().slice(0, 10);
    const dayName = days[date.getUTCDay()];

    if (preference_date && iso !== preference_date) continue;
    if (preference_day && dayName.toLowerCase() !== preference_day.toLowerCase()) continue;

    const holiday = (holidayHours || []).find((h: { date: string }) => h.date === iso);
    if (holiday && !holiday.is_open) continue;
    const dayHours = (openingHours || []).find((h: { day: string }) => h.day === dayName);
    if (!dayHours || !dayHours.is_open) continue;

    const existing = (allExisting || []).filter((a: { starts_at: string }) => a.starts_at.slice(0, 10) === iso);

    for (const prac of practitioners) {
      const whArr = Array.isArray(prac.working_hours) ? prac.working_hours : [];
      const wh = whArr.find((w: { day: string }) => w.day === dayName);
      if (whArr.length > 0 && (!wh || !wh.is_working)) continue;

      const startMin = timeToMinutes(wh?.start_time || dayHours.open_time);
      const endMin = timeToMinutes(wh?.end_time || dayHours.close_time);
      const bufferMins = opts.service?.buffer_minutes || 10;
      const blocked = (existing || [])
        .filter((a: { practitioner_id: string }) => a.practitioner_id === prac.id)
        .map((a: { starts_at: string; ends_at: string }) => ({
          start: timeToMinutes(a.starts_at.slice(11, 16)),
          end: timeToMinutes(a.ends_at.slice(11, 16)) + bufferMins,
        }));

      for (let t = startMin; t + totalMinutes <= endMin; t += 15) {
        const slotEnd = t + totalMinutes;
        if (blocked.some((b: { start: number; end: number }) => t < b.end && slotEnd > b.start)) continue;

        if (preference_time) {
          if (preference_time === "morning" && t >= 720) continue;
          if (preference_time === "afternoon" && t < 720) continue;
          if (preference_time.includes(":")) {
            const prefMin = timeToMinutes(preference_time);
            if (Math.abs(t - prefMin) > 120) continue;
          }
        }

        const startTime = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
        const endTime = `${String(Math.floor(slotEnd / 60)).padStart(2, "0")}:${String(slotEnd % 60).padStart(2, "0")}`;

        slots.push({
          practitioner_id: prac.id,
          practitioner_name: prac.name,
          date: iso,
          day: dayName,
          start_time: startTime,
          end_time: endTime,
          display: `${dayName} the ${ordinal(date.getUTCDate())} at ${startTime} with ${prac.name.split(" ")[0]}`,
        });
      }
    }
  }
  return slots;
}
