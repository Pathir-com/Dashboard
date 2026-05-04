/**
 * applyScrapedClinic
 *
 * Maps the structured output of `scrape-website` into the practice schema
 * (practices row + practitioners JSONB + price_list JSONB) and persists
 * via the existing `updatePractice`, which handles the JSONB → relational
 * sync (services + practitioners tables) for us.
 *
 * Used by:
 *   - Onboarding Step 2 ("Auto-fill from website" button)
 *   - Settings → Clinic Details ("Re-run scraper" button)
 *
 * Idempotent: re-running with the same input produces the same DB state.
 *
 * Behaviour for partial extraction: any field returned empty by the scraper
 * is left UNTOUCHED on the practice row (we never overwrite real data with
 * blanks). Arrays are only replaced if the scraper returned at least one item.
 */

import { updatePractice } from './supabaseData';

/** @typedef {{
 *   name: string, phone: string, email: string, address: string, description: string,
 *   services: Array<{name: string, description?: string, price?: string}>,
 *   business_hours: Array<{day: string, is_open: boolean, open_time: string, close_time: string}>,
 *   staff: Array<{name: string, title?: string, credentials?: string, specialty?: string, bio?: string}>,
 *   faqs: Array<{question: string, answer: string}>,
 *   insurance_accepted: string[],
 *   appointment_booking_url: string,
 *   agent_tone: string,
 *   clinic_guidelines: string,
 * }} ScrapedClinic */

/** Map the scraper's `services` array into the `price_list` JSONB shape. */
export function servicesToPriceList(services) {
  return (services || [])
    .filter((s) => s?.name)
    .map((s) => ({
      service_name: s.name,
      category: 'general',
      price: parsePrice(s.price),
      description: s.description || '',
      notes: '',
      is_from_price: typeof s.price === 'string' && /from/i.test(s.price),
    }));
}

/** Map the scraper's `staff` array into the `practitioners` JSONB shape. */
export function staffToPractitioners(staff) {
  return (staff || [])
    .filter((p) => p?.name)
    .map((p) => ({
      name: p.name,
      title: p.title || '',
      credentials: p.credentials || '',
      bio: p.bio || (p.specialty ? `Specialises in ${p.specialty}.` : ''),
      services: [], // user fills this in via UI; auto-mapping is a v2
    }));
}

/** "from £85" / "£85.00" / "£85 - £120" → "85" (string, leading from-flag tracked separately). */
function parsePrice(raw) {
  if (!raw) return '';
  const m = String(raw).match(/£?(\d+(?:\.\d{1,2})?)/);
  return m ? m[1] : '';
}

const ALL_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

/** Normalise scraper hours into the 7-row shape the dashboard expects. */
export function normaliseHours(hours) {
  if (!hours || hours.length === 0) return null;
  const byDay = new Map(
    hours.map((h) => [String(h.day || '').toLowerCase(), h]),
  );
  return ALL_DAYS.map((day) => {
    const match = byDay.get(day.toLowerCase());
    if (match) {
      return {
        day,
        is_open: !!match.is_open,
        open_time: match.open_time || '09:00',
        close_time: match.close_time || '17:30',
      };
    }
    return { day, is_open: day !== 'Saturday' && day !== 'Sunday', open_time: '09:00', close_time: '17:30' };
  });
}

/**
 * Build the patch that should be sent to updatePractice. Pure function —
 * no side effects, easily unit-tested.
 *
 * @param {ScrapedClinic} extracted
 * @returns {object} patch suitable for updatePractice
 */
export function buildPracticePatch(extracted) {
  if (!extracted) return {};
  const patch = {};

  if (extracted.name)        patch.name = extracted.name;
  if (extracted.phone)       patch.phone = extracted.phone;
  if (extracted.email)       patch.email = extracted.email;
  if (extracted.address)     patch.address = extracted.address;
  if (extracted.description) patch.usps = extracted.description;

  if (extracted.agent_tone)        patch.agent_tone = extracted.agent_tone;
  if (extracted.clinic_guidelines) patch.clinic_guidelines = extracted.clinic_guidelines;

  const priceList = servicesToPriceList(extracted.services);
  if (priceList.length > 0) patch.price_list = priceList;

  const practitioners = staffToPractitioners(extracted.staff);
  if (practitioners.length > 0) patch.practitioners = practitioners;

  const hours = normaliseHours(extracted.business_hours);
  if (hours) patch.opening_hours = hours;

  return patch;
}

/**
 * Apply scraped data to a practice. Updates DB + returns the merged row.
 * Caller decides whether to refresh local state.
 *
 * @param {string} practiceId
 * @param {ScrapedClinic} extracted
 */
export async function applyScrapedClinic(practiceId, extracted) {
  const patch = buildPracticePatch(extracted);
  if (Object.keys(patch).length === 0) return null;
  return updatePractice(practiceId, patch);
}
