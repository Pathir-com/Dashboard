/**
 * Practice hours utilities — timezone-aware open/close status for Europe/London.
 * Pure functions, no DB dependency.
 */

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function findNextOpen(
  openingHours: Array<{ day: string; is_open: boolean; open_time: string }>,
  holidayHours: Array<{ date: string; is_open: boolean }>,
  fromISO: string,
) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const from = new Date(fromISO + "T12:00:00Z");
  for (let i = 1; i <= 7; i++) {
    const next = new Date(from.getTime() + i * 86400000);
    const iso = next.toISOString().slice(0, 10);
    const holiday = (holidayHours || []).find((h) => h.date === iso);
    if (holiday && !holiday.is_open) continue;
    const dayName = days[next.getUTCDay()];
    const hours = (openingHours || []).find((h) => h.day === dayName);
    if (hours && hours.is_open) {
      return { day: dayName, date: iso, open_time: hours.open_time };
    }
  }
  return null;
}

// deno-lint-ignore no-explicit-any
export function getPracticeHoursStatus(openingHours: any[], holidayHours: any[]) {
  const now = new Date();
  const londonFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = londonFormatter.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value || "";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");
  const currentMinutes = hour * 60 + minute;
  const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const dateParts = dateFormatter.formatToParts(now);
  const todayISO = `${dateParts.find((p) => p.type === "year")?.value}-${dateParts.find((p) => p.type === "month")?.value}-${dateParts.find((p) => p.type === "day")?.value}`;

  // Holiday override
  const holiday = (holidayHours || []).find((h: { date: string }) => h.date === todayISO);
  if (holiday) {
    if (!holiday.is_open) {
      return { is_open_now: false, current_time: timeStr, today_hours: null, is_holiday: true, holiday_label: holiday.label || "Holiday", next_open: findNextOpen(openingHours, holidayHours, todayISO) };
    }
    const hOpen = timeToMinutes(holiday.open_time || "09:00");
    const hClose = timeToMinutes(holiday.close_time || "17:00");
    const isOpen = currentMinutes >= hOpen && currentMinutes < hClose;
    return {
      is_open_now: isOpen, current_time: timeStr,
      today_hours: { open_time: holiday.open_time, close_time: holiday.close_time },
      closes_in_minutes: isOpen ? hClose - currentMinutes : 0,
      closing_soon: isOpen && hClose - currentMinutes <= 30,
      is_holiday: true, holiday_label: holiday.label || "Holiday hours",
      next_open: isOpen ? null : findNextOpen(openingHours, holidayHours, todayISO),
    };
  }

  // Regular hours
  const todayHours = (openingHours || []).find((h: { day: string }) => h.day.toLowerCase() === weekday.toLowerCase());
  if (!todayHours || !todayHours.is_open) {
    return { is_open_now: false, current_time: timeStr, today_hours: null, next_open: findNextOpen(openingHours, holidayHours, todayISO) };
  }

  const openMin = timeToMinutes(todayHours.open_time);
  const closeMin = timeToMinutes(todayHours.close_time);
  const isOpen = currentMinutes >= openMin && currentMinutes < closeMin;

  return {
    is_open_now: isOpen, current_time: timeStr,
    today_hours: { open_time: todayHours.open_time, close_time: todayHours.close_time },
    closes_in_minutes: isOpen ? closeMin - currentMinutes : 0,
    closing_soon: isOpen && closeMin - currentMinutes <= 30,
    next_open: isOpen ? null : findNextOpen(openingHours, holidayHours, todayISO),
  };
}
