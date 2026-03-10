/**
 * Purpose:
 *     Searches practitioner diaries for available appointment slots.
 *     Handles day/time preferences, urgency levels, and escalating search windows.
 *
 * Dependencies:
 *     - practitioners, services, practitioner_services, appointments tables
 *     - practice-hours.js (getDayHours — filters to open days)
 *
 * Used by:
 *     - api/availability.js (REST endpoint)
 *     - api/vapi-server-url.js (search_availability tool)
 *     - api/chatbase-action.js (chat booking action)
 *
 * Changes:
 *     2026-03-10: Initial creation
 */

import { getDayHours } from "./practice-hours.js";

const SLOT_INTERVAL_MINUTES = 15; // Round slots to 15-min boundaries

/**
 * Search for available appointment slots.
 *
 * @param {object} db - Supabase admin client
 * @param {object} params
 * @param {string} params.practice_id
 * @param {string} params.service_name - Matched against services.name
 * @param {string} [params.preference_day] - "monday", "thursday", etc.
 * @param {string} [params.preference_time] - "morning", "afternoon", or "HH:MM"
 * @param {string} [params.preference_date] - "YYYY-MM-DD" specific date
 * @param {boolean} [params.is_urgent] - If true, search 3 days then 5 days
 * @param {Array} params.opening_hours - practice.opening_hours
 * @param {Array} [params.holiday_hours] - practice.holiday_hours
 * @returns {{ slots: Array, message: string, search_window_days: number }}
 */
export async function searchAvailability(db, params) {
  const {
    practice_id,
    service_name,
    preference_day,
    preference_time,
    preference_date,
    is_urgent = false,
    opening_hours = [],
    holiday_hours = [],
  } = params;

  // 1. Resolve the service
  const { data: service } = await db
    .from("services")
    .select("id, name, duration_minutes, buffer_minutes")
    .eq("practice_id", practice_id)
    .ilike("name", `%${service_name}%`)
    .limit(1)
    .single();

  if (!service) {
    return { slots: [], message: `No service matching "${service_name}" found.` };
  }

  const totalBlock = service.duration_minutes + (service.buffer_minutes || 10);

  // 2. Find eligible practitioners (those who offer this service)
  const { data: practitionerLinks } = await db
    .from("practitioner_services")
    .select("practitioner_id")
    .eq("service_id", service.id);

  if (!practitionerLinks || practitionerLinks.length === 0) {
    return { slots: [], message: "No practitioners available for this service." };
  }

  const practitionerIds = practitionerLinks.map(l => l.practitioner_id);

  const { data: practitioners } = await db
    .from("practitioners")
    .select("id, name, title, working_hours")
    .in("id", practitionerIds);

  if (!practitioners || practitioners.length === 0) {
    return { slots: [], message: "No practitioners available for this service." };
  }

  // 3. Determine search window
  let searchDays;
  if (preference_date) {
    // Specific date — search just that date (+ nearby if nothing)
    searchDays = [preference_date];
  } else if (is_urgent) {
    // Urgent: 3 days first, expand to 5 if needed
    searchDays = getNextWorkingDays(3, opening_hours, holiday_hours, preference_day);
  } else {
    // Non-urgent: 2 weeks
    searchDays = getNextWorkingDays(14, opening_hours, holiday_hours, preference_day);
  }

  // 4. Search each day for each practitioner
  let slots = [];

  for (const dateStr of searchDays) {
    const dayHours = getDayHours(dateStr, opening_hours, holiday_hours);
    if (!dayHours.is_open) continue;

    for (const practitioner of practitioners) {
      const practHours = getPractitionerHoursForDate(practitioner.working_hours, dateStr);
      if (!practHours) continue; // Day off for this practitioner

      // Narrow to the intersection of practice hours and practitioner hours
      const windowStart = laterTime(dayHours.open_time, practHours.start);
      const windowEnd = earlierTime(dayHours.close_time, practHours.end);
      if (timeToMinutes(windowStart) >= timeToMinutes(windowEnd)) continue;

      // Apply time-of-day preference
      const { searchStart, searchEnd } = applyTimePreference(
        windowStart, windowEnd, preference_time
      );

      // Get existing appointments for this practitioner on this day
      const dayStart = `${dateStr}T00:00:00`;
      const dayEnd = `${dateStr}T23:59:59`;

      const { data: existingAppts } = await db
        .from("appointments")
        .select("starts_at, ends_at")
        .eq("practitioner_id", practitioner.id)
        .gte("starts_at", dayStart)
        .lte("starts_at", dayEnd)
        .neq("status", "cancelled")
        .order("starts_at", { ascending: true });

      // Build blocked intervals (appointment + buffer)
      const blocked = (existingAppts || []).map(a => ({
        start: timeToMinutes(extractTime(a.starts_at)),
        end: timeToMinutes(extractTime(a.ends_at)) + (service.buffer_minutes || 10),
      }));

      // Find free slots
      const freeSlots = findFreeSlots(
        timeToMinutes(searchStart),
        timeToMinutes(searchEnd),
        blocked,
        totalBlock,
      );

      for (const slotStart of freeSlots) {
        const slotEnd = slotStart + service.duration_minutes;
        slots.push({
          practitioner_id: practitioner.id,
          practitioner_name: practitioner.name,
          practitioner_title: practitioner.title,
          service_id: service.id,
          service_name: service.name,
          date: dateStr,
          start_time: minutesToTime(slotStart),
          end_time: minutesToTime(slotEnd),
          display: formatSlotDisplay(dateStr, slotStart, practitioner),
        });
      }
    }
  }

  // 5. If urgent and nothing found in initial window, expand
  if (is_urgent && slots.length === 0 && !preference_date) {
    const expandedDays = getNextWorkingDays(5, opening_hours, holiday_hours, preference_day);
    // Only search the extra days we haven't checked
    const extraDays = expandedDays.filter(d => !searchDays.includes(d));

    for (const dateStr of extraDays) {
      const dayHours = getDayHours(dateStr, opening_hours, holiday_hours);
      if (!dayHours.is_open) continue;

      for (const practitioner of practitioners) {
        const practHours = getPractitionerHoursForDate(practitioner.working_hours, dateStr);
        if (!practHours) continue;

        const windowStart = laterTime(dayHours.open_time, practHours.start);
        const windowEnd = earlierTime(dayHours.close_time, practHours.end);
        if (timeToMinutes(windowStart) >= timeToMinutes(windowEnd)) continue;

        const { searchStart, searchEnd } = applyTimePreference(windowStart, windowEnd, preference_time);

        const dayStart = `${dateStr}T00:00:00`;
        const dayEnd = `${dateStr}T23:59:59`;
        const { data: existingAppts } = await db
          .from("appointments")
          .select("starts_at, ends_at")
          .eq("practitioner_id", practitioner.id)
          .gte("starts_at", dayStart)
          .lte("starts_at", dayEnd)
          .neq("status", "cancelled")
          .order("starts_at", { ascending: true });

        const blocked = (existingAppts || []).map(a => ({
          start: timeToMinutes(extractTime(a.starts_at)),
          end: timeToMinutes(extractTime(a.ends_at)) + (service.buffer_minutes || 10),
        }));

        const freeSlots = findFreeSlots(
          timeToMinutes(searchStart), timeToMinutes(searchEnd), blocked, totalBlock,
        );

        for (const slotStart of freeSlots) {
          const slotEnd = slotStart + service.duration_minutes;
          slots.push({
            practitioner_id: practitioner.id,
            practitioner_name: practitioner.name,
            practitioner_title: practitioner.title,
            service_id: service.id,
            service_name: service.name,
            date: dateStr,
            start_time: minutesToTime(slotStart),
            end_time: minutesToTime(slotEnd),
            display: formatSlotDisplay(dateStr, slotStart, practitioner),
          });
        }
      }
    }
  }

  // 6. If specific date requested and nothing found, search nearby dates
  if (preference_date && slots.length === 0) {
    const nearbyDays = getNearbyDays(preference_date, 5, opening_hours, holiday_hours);
    for (const dateStr of nearbyDays) {
      const dayHours = getDayHours(dateStr, opening_hours, holiday_hours);
      if (!dayHours.is_open) continue;

      for (const practitioner of practitioners) {
        const practHours = getPractitionerHoursForDate(practitioner.working_hours, dateStr);
        if (!practHours) continue;

        const windowStart = laterTime(dayHours.open_time, practHours.start);
        const windowEnd = earlierTime(dayHours.close_time, practHours.end);
        if (timeToMinutes(windowStart) >= timeToMinutes(windowEnd)) continue;

        const { searchStart, searchEnd } = applyTimePreference(windowStart, windowEnd, preference_time);

        const dayStart = `${dateStr}T00:00:00`;
        const dayEnd = `${dateStr}T23:59:59`;
        const { data: existingAppts } = await db
          .from("appointments")
          .select("starts_at, ends_at")
          .eq("practitioner_id", practitioner.id)
          .gte("starts_at", dayStart)
          .lte("starts_at", dayEnd)
          .neq("status", "cancelled")
          .order("starts_at", { ascending: true });

        const blocked = (existingAppts || []).map(a => ({
          start: timeToMinutes(extractTime(a.starts_at)),
          end: timeToMinutes(extractTime(a.ends_at)) + (service.buffer_minutes || 10),
        }));

        const freeSlots = findFreeSlots(
          timeToMinutes(searchStart), timeToMinutes(searchEnd), blocked, totalBlock,
        );

        for (const slotStart of freeSlots) {
          const slotEnd = slotStart + service.duration_minutes;
          slots.push({
            practitioner_id: practitioner.id,
            practitioner_name: practitioner.name,
            practitioner_title: practitioner.title,
            service_id: service.id,
            service_name: service.name,
            date: dateStr,
            start_time: minutesToTime(slotStart),
            end_time: minutesToTime(slotEnd),
            display: formatSlotDisplay(dateStr, slotStart, practitioner),
          });
        }
      }
    }
  }

  // 7. Limit and return
  const maxSlots = is_urgent ? 3 : 5;
  const limitedSlots = slots.slice(0, maxSlots);
  const searchWindowDays = is_urgent ? (slots.length === 0 ? 5 : 3) : 14;

  let message;
  if (limitedSlots.length > 0) {
    message = `Found ${limitedSlots.length} available slot${limitedSlots.length === 1 ? "" : "s"}.`;
  } else if (preference_date) {
    message = `No availability on ${preference_date} or nearby dates for ${service.name}.`;
  } else {
    message = `No availability found in the next ${searchWindowDays} days for ${service.name}.`;
  }

  return { slots: limitedSlots, message, search_window_days: searchWindowDays };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the next N calendar days from today, optionally filtered to a specific day name.
 */
function getNextWorkingDays(count, openingHours, holidayHours, preferredDay) {
  const days = [];
  const today = new Date();

  for (let offset = 0; offset < count + 10 && days.length < count; offset++) {
    const candidate = new Date(today.getTime() + offset * 86400000);
    const dateStr = candidate.toISOString().split("T")[0];

    // If preferred day specified, only include that day of week
    if (preferredDay) {
      const dayName = candidate.toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/London" });
      if (dayName.toLowerCase() !== preferredDay.toLowerCase()) continue;
    }

    days.push(dateStr);
  }

  return days;
}

/**
 * Get nearby dates around a target date (before and after).
 */
function getNearbyDays(targetDate, range, openingHours, holidayHours) {
  const target = new Date(targetDate + "T12:00:00Z");
  const days = [];

  for (let offset = -range; offset <= range; offset++) {
    if (offset === 0) continue; // Skip the target itself (already searched)
    const candidate = new Date(target.getTime() + offset * 86400000);
    if (candidate < new Date()) continue; // Skip past dates
    days.push(candidate.toISOString().split("T")[0]);
  }

  // Sort by closeness to the target date
  days.sort((a, b) => {
    const distA = Math.abs(new Date(a).getTime() - target.getTime());
    const distB = Math.abs(new Date(b).getTime() - target.getTime());
    return distA - distB;
  });

  return days;
}

/**
 * Get a practitioner's working hours for a given date.
 * Returns { start, end } or null if day off.
 */
function getPractitionerHoursForDate(workingHours, dateStr) {
  if (!workingHours) return null;

  const date = new Date(dateStr + "T12:00:00Z");
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayName = dayNames[date.getUTCDay()];

  const hours = workingHours[dayName];
  if (!hours || !hours.start || !hours.end) return null;

  return hours;
}

/**
 * Apply time-of-day preference to narrow the search window.
 */
function applyTimePreference(windowStart, windowEnd, preference) {
  if (!preference) return { searchStart: windowStart, searchEnd: windowEnd };

  const pref = preference.toLowerCase().trim();

  if (pref === "morning") {
    return {
      searchStart: windowStart,
      searchEnd: earlierTime(windowEnd, "12:00"),
    };
  }

  if (pref === "afternoon") {
    return {
      searchStart: laterTime(windowStart, "12:00"),
      searchEnd: windowEnd,
    };
  }

  // Specific time — search within 2 hours either side
  if (pref.match(/^\d{1,2}:\d{2}$/)) {
    const prefMinutes = timeToMinutes(pref);
    return {
      searchStart: minutesToTime(Math.max(timeToMinutes(windowStart), prefMinutes - 120)),
      searchEnd: minutesToTime(Math.min(timeToMinutes(windowEnd), prefMinutes + 120)),
    };
  }

  return { searchStart: windowStart, searchEnd: windowEnd };
}

/**
 * Find free slots within a window, avoiding blocked intervals.
 */
function findFreeSlots(windowStartMins, windowEndMins, blocked, totalBlockMins) {
  const slots = [];

  // Round start to nearest slot interval
  let cursor = Math.ceil(windowStartMins / SLOT_INTERVAL_MINUTES) * SLOT_INTERVAL_MINUTES;

  while (cursor + totalBlockMins <= windowEndMins) {
    const slotEnd = cursor + totalBlockMins;
    const overlaps = blocked.some(b => cursor < b.end && slotEnd > b.start);

    if (!overlaps) {
      slots.push(cursor);
    }

    cursor += SLOT_INTERVAL_MINUTES;
  }

  return slots;
}

/**
 * Format a slot for spoken/display output.
 * e.g. "Thursday the 14th of March at 9:30 in the morning with Sarah"
 */
function formatSlotDisplay(dateStr, slotStartMins, practitioner) {
  const date = new Date(dateStr + "T12:00:00Z");
  const dayName = date.toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/London" });
  const dayNum = date.getUTCDate();
  const month = date.toLocaleDateString("en-GB", { month: "long", timeZone: "Europe/London" });
  const ordinal = getOrdinal(dayNum);
  const timeStr = minutesToTime(slotStartMins);
  const firstName = (practitioner.name || "").split(" ")[0];

  return `${dayName} the ${dayNum}${ordinal} of ${month} at ${timeStr} with ${firstName}`;
}

function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function laterTime(a, b) {
  return timeToMinutes(a) >= timeToMinutes(b) ? a : b;
}

function earlierTime(a, b) {
  return timeToMinutes(a) <= timeToMinutes(b) ? a : b;
}

function extractTime(isoStr) {
  if (!isoStr) return "00:00";
  const d = new Date(isoStr);
  // Convert to London time
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/London" });
}
