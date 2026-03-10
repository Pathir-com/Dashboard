/**
 * Purpose:
 *     Determines whether a practice is currently open, closing soon, or closed.
 *     Returns structured data so the AI never guesses — it reads a boolean.
 *
 * Dependencies:
 *     - practices.opening_hours JSONB (day, is_open, open_time, close_time)
 *     - practices.holiday_hours JSONB (date-based overrides)
 *
 * Used by:
 *     - api/vapi-server-url.js (included in lookup_caller_phone response)
 *     - api/_lib/availability-search.js (filters search to open days)
 *     - api/chatbase-action.js (included in practice context)
 *
 * Changes:
 *     2026-03-10: Initial creation
 */

const TIMEZONE = "Europe/London";
const CLOSING_SOON_THRESHOLD_MINUTES = 30;

/**
 * Day name mapping — JS getDay() returns 0=Sunday.
 * Practice opening_hours uses capitalised day names.
 */
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Get the current practice hours status.
 *
 * @param {Array} openingHours - practice.opening_hours JSONB
 * @param {Array} holidayHours - practice.holiday_hours JSONB (optional)
 * @returns {{ is_open_now, current_time, today_hours, closes_in_minutes, next_open, is_holiday }}
 */
export function getPracticeHoursStatus(openingHours = [], holidayHours = []) {
  const now = new Date();

  // Get practice-local time components
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(now).map(p => [p.type, p.value])
  );

  const currentTime = `${parts.hour}:${parts.minute}`;
  const currentDateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const currentMinutes = timeToMinutes(currentTime);

  // Get day name in practice timezone
  const dayFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    weekday: "long",
  });
  const todayName = dayFormatter.format(now);

  // Check holiday overrides first
  const holidayToday = (holidayHours || []).find(h => h.date === currentDateStr);
  if (holidayToday) {
    if (!holidayToday.is_open) {
      return {
        is_open_now: false,
        current_time: currentTime,
        today_hours: null,
        closes_in_minutes: null,
        next_open: findNextOpen(openingHours, holidayHours, now),
        is_holiday: true,
      };
    }
    // Holiday with reduced hours
    return buildStatus(currentTime, currentMinutes, {
      open_time: holidayToday.open_time,
      close_time: holidayToday.close_time,
    }, openingHours, holidayHours, now, true);
  }

  // Check regular hours for today
  const todayHours = openingHours.find(
    h => h.day.toLowerCase() === todayName.toLowerCase()
  );

  if (!todayHours || !todayHours.is_open) {
    return {
      is_open_now: false,
      current_time: currentTime,
      today_hours: null,
      closes_in_minutes: null,
      next_open: findNextOpen(openingHours, holidayHours, now),
      is_holiday: false,
    };
  }

  return buildStatus(currentTime, currentMinutes, todayHours, openingHours, holidayHours, now, false);
}

/**
 * Build the hours status for a day that has opening hours.
 */
function buildStatus(currentTime, currentMinutes, hours, openingHours, holidayHours, now, isHoliday) {
  const openMinutes = timeToMinutes(hours.open_time);
  const closeMinutes = timeToMinutes(hours.close_time);

  const isWithinHours = currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  const closesInMinutes = isWithinHours ? closeMinutes - currentMinutes : null;

  return {
    is_open_now: isWithinHours,
    current_time: currentTime,
    today_hours: {
      open_time: hours.open_time,
      close_time: hours.close_time,
    },
    closes_in_minutes: closesInMinutes,
    closing_soon: isWithinHours && closesInMinutes <= CLOSING_SOON_THRESHOLD_MINUTES,
    next_open: isWithinHours ? null : findNextOpen(openingHours, holidayHours, now),
    is_holiday: isHoliday,
  };
}

/**
 * Find the next time the practice opens (looking up to 7 days ahead).
 */
function findNextOpen(openingHours, holidayHours, fromDate) {
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = new Date(fromDate.getTime() + offset * 86400000);

    const dayFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE,
      weekday: "long",
    });
    const dayName = dayFormatter.format(candidate);

    const dateFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dateParts = Object.fromEntries(
      dateFormatter.formatToParts(candidate).map(p => [p.type, p.value])
    );
    const dateStr = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;

    // Check holiday override
    const holiday = (holidayHours || []).find(h => h.date === dateStr);
    if (holiday) {
      if (holiday.is_open) {
        return { day: dayName, date: dateStr, open_time: holiday.open_time };
      }
      continue; // Closed holiday — skip
    }

    // Check regular hours
    const hours = (openingHours || []).find(
      h => h.day.toLowerCase() === dayName.toLowerCase()
    );
    if (hours && hours.is_open) {
      return { day: dayName, date: dateStr, open_time: hours.open_time };
    }
  }

  return null; // Nothing found in the next 7 days (unusual)
}

/**
 * Convert "HH:MM" to minutes since midnight.
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Check if a given date string is a working day for the practice.
 * Used by availability search to skip closed days.
 *
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {Array} openingHours
 * @param {Array} holidayHours
 * @returns {{ is_open: boolean, open_time?: string, close_time?: string }}
 */
export function getDayHours(dateStr, openingHours = [], holidayHours = []) {
  // Check holiday override
  const holiday = (holidayHours || []).find(h => h.date === dateStr);
  if (holiday) {
    if (!holiday.is_open) return { is_open: false };
    return { is_open: true, open_time: holiday.open_time, close_time: holiday.close_time };
  }

  // Get day name from date
  const date = new Date(dateStr + "T12:00:00Z"); // Noon to avoid timezone edge
  const dayName = DAY_NAMES[date.getUTCDay()];

  const hours = (openingHours || []).find(
    h => h.day.toLowerCase() === dayName.toLowerCase()
  );

  if (!hours || !hours.is_open) return { is_open: false };
  return { is_open: true, open_time: hours.open_time, close_time: hours.close_time };
}
