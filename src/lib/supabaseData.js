/**
 * Purpose:
 *   Supabase data layer — replaces localStorage for logged-in users.
 *   Provides CRUD for practices, enquiries, practitioners, appointments,
 *   and appointment requests.
 *
 * Dependencies:
 *   - @/lib/supabase (Supabase client singleton)
 *
 * Used by:
 *   - src/pages/Clinic.jsx (practice + enquiry fetching)
 *   - src/components/clinic/ClinicSettings.jsx (practice updates)
 *   - src/components/clinic/DiaryView.jsx (appointments + practitioners)
 *   - src/pages/Internal.jsx (practice management)
 *
 * Changes:
 *   2026-03-11: Added practitioners, appointments, and appointment request queries
 *               for the diary/booking system.
 *   2026-03-09: Initial creation with profile, practice, and enquiry CRUD.
 */
import { supabase } from '@/lib/supabase';

// --------------- Profile ---------------

export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) throw error;
  return data;
}

export async function updateProfile(updates) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// --------------- Practices ---------------

export async function listPractices() {
  const { data, error } = await supabase
    .from('practices')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function getPractice(id) {
  const { data, error } = await supabase
    .from('practices')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

export async function getMyPractice() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('practices')
    .select('*')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createPractice(practiceData) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('practices')
    .insert({
      ...practiceData,
      owner_id: user.id,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Only send columns that exist in the Supabase practices table
const PRACTICE_COLUMNS = new Set([
  'name', 'address', 'phone', 'email', 'website', 'practice_type',
  'opening_hours', 'holiday_hours', 'practitioners', 'price_list',
  'integrations', 'usps', 'practice_plan', 'chatbase_agent_id',
  'elevenlabs_agent_id', 'twilio_phone_number', 'stripe_subscription_id',
  'onboarding_completed', 'pear_dental', 'finance_document_url',
  'email_verified', 'email_verification_code', 'email_verification_sent_at',
]);

function filterPracticeFields(obj) {
  const filtered = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PRACTICE_COLUMNS.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export async function updatePractice(id, updates) {
  const safeUpdates = filterPracticeFields(updates);
  const { data, error } = await supabase
    .from('practices')
    .update(safeUpdates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  // Sync price_list → services table so the booking system stays current
  if (updates.price_list) {
    syncServicesFromPriceList(id, updates.price_list);
  }

  // Sync practitioners JSONB → practitioners table + practitioner_services
  if (updates.practitioners) {
    syncPractitionersFromJSONB(id, updates.practitioners);
  }

  return data;
}

/**
 * Sync the practice's price_list JSONB into the services table.
 * Any service in the price list that doesn't exist in the services table
 * gets created; existing ones are updated; removed ones are deleted.
 * Runs in the background — does not block the save.
 */
async function syncServicesFromPriceList(practiceId, priceList) {
  try {
    // Fetch current services for this practice
    const { data: existing } = await supabase
      .from('services')
      .select('id, name, category, price_pence, duration_minutes')
      .eq('practice_id', practiceId);

    const existingByName = {};
    for (const svc of (existing || [])) {
      existingByName[svc.name.toLowerCase()] = svc;
    }

    const seenNames = new Set();

    for (const item of (priceList || [])) {
      const name = item.service_name || '';
      if (!name) continue;
      seenNames.add(name.toLowerCase());

      const pricePence = item.price ? Math.round(parseFloat(item.price) * 100) : null;
      const category = (item.category || 'general').toLowerCase();

      const match = existingByName[name.toLowerCase()];
      if (match) {
        // Update if price or category changed
        if (match.price_pence !== pricePence || match.category !== category) {
          await supabase.from('services').update({
            category,
            price_pence: pricePence,
          }).eq('id', match.id);
        }
      } else {
        // Create new service
        await supabase.from('services').insert({
          practice_id: practiceId,
          name,
          category,
          price_pence: pricePence,
          duration_minutes: 30, // sensible default
          buffer_minutes: 5,
        });
      }
    }

    // Delete services no longer in the price list
    for (const svc of (existing || [])) {
      if (!seenNames.has(svc.name.toLowerCase())) {
        await supabase.from('services').delete().eq('id', svc.id);
      }
    }
  } catch (err) {
    console.error('Failed to sync services from price list:', err);
  }
}

/**
 * Sync the practice's practitioners JSONB array into the practitioners table
 * and practitioner_services join table. Matches by name (case-insensitive).
 * Creates new practitioners, updates existing ones, removes stale ones.
 * Then links each practitioner's services array to the services table.
 */
async function syncPractitionersFromJSONB(practiceId, practitionersJsonb) {
  try {
    // 1. Fetch existing practitioners for this practice
    const { data: existing } = await supabase
      .from('practitioners')
      .select('id, name, title, credentials, bio')
      .eq('practice_id', practiceId);

    const existingByName = {};
    for (const p of (existing || [])) {
      existingByName[p.name.toLowerCase()] = p;
    }

    // 2. Fetch all services for name matching
    const { data: allServices } = await supabase
      .from('services')
      .select('id, name')
      .eq('practice_id', practiceId);

    const servicesByName = {};
    for (const svc of (allServices || [])) {
      servicesByName[svc.name.toLowerCase()] = svc;
    }

    const seenNames = new Set();
    const practitionerIdMap = {}; // name → DB uuid

    // 3. Upsert each practitioner
    for (const p of (practitionersJsonb || [])) {
      const name = p.name || '';
      if (!name) continue;
      seenNames.add(name.toLowerCase());

      const match = existingByName[name.toLowerCase()];
      const fields = {
        title: p.title || null,
        credentials: p.credentials || null,
        bio: p.bio || null,
      };

      if (match) {
        // Update if anything changed
        const changed = Object.entries(fields).some(
          ([k, v]) => match[k] !== v
        );
        if (changed) {
          await supabase.from('practitioners')
            .update(fields)
            .eq('id', match.id);
        }
        practitionerIdMap[name.toLowerCase()] = match.id;
      } else {
        // Create new practitioner
        const { data: created } = await supabase
          .from('practitioners')
          .insert({
            practice_id: practiceId,
            name,
            ...fields,
          })
          .select('id')
          .single();
        if (created) {
          practitionerIdMap[name.toLowerCase()] = created.id;
        }
      }
    }

    // 4. Delete practitioners no longer in JSONB
    for (const p of (existing || [])) {
      if (!seenNames.has(p.name.toLowerCase())) {
        await supabase.from('practitioners').delete().eq('id', p.id);
      }
    }

    // 5. Sync practitioner_services for each practitioner
    for (const p of (practitionersJsonb || [])) {
      const name = p.name || '';
      const practitionerId = practitionerIdMap[name.toLowerCase()];
      if (!practitionerId || !Array.isArray(p.services)) continue;

      // Fetch current links
      const { data: currentLinks } = await supabase
        .from('practitioner_services')
        .select('service_id')
        .eq('practitioner_id', practitionerId);

      const currentServiceIds = new Set(
        (currentLinks || []).map(l => l.service_id)
      );

      // Resolve service names → IDs (case-insensitive, try normalised forms)
      const desiredServiceIds = new Set();
      for (const svcName of p.services) {
        const serviceId = resolveServiceId(svcName, servicesByName);
        if (serviceId) desiredServiceIds.add(serviceId);
      }

      // Add missing links
      for (const svcId of desiredServiceIds) {
        if (!currentServiceIds.has(svcId)) {
          await supabase.from('practitioner_services').insert({
            practitioner_id: practitionerId,
            service_id: svcId,
          });
        }
      }

      // Remove stale links
      for (const svcId of currentServiceIds) {
        if (!desiredServiceIds.has(svcId)) {
          await supabase.from('practitioner_services')
            .delete()
            .eq('practitioner_id', practitionerId)
            .eq('service_id', svcId);
        }
      }
    }
  } catch (err) {
    console.error('Failed to sync practitioners from JSONB:', err);
  }
}

/**
 * Try to match a practitioner's service name to a service in the DB.
 * Uses multiple strategies: exact, plural normalisation, core-word overlap,
 * and substring matching after stripping parentheticals.
 */
function resolveServiceId(serviceName, servicesByName) {
  const lower = serviceName.toLowerCase();

  // 1. Exact match
  if (servicesByName[lower]) return servicesByName[lower].id;

  // 2. Try stripping/adding trailing 's' (Crowns → Crown, Filling → Fillings)
  if (lower.endsWith('s') && servicesByName[lower.slice(0, -1)]) {
    return servicesByName[lower.slice(0, -1)].id;
  }
  if (servicesByName[lower + 's']) return servicesByName[lower + 's'].id;

  // 3. Strip parenthetical content and compare both ways
  const stripParens = (s) => s.replace(/\s*\([^)]*\)/g, '').trim();
  const stripped = stripParens(lower);
  for (const [dbName, svc] of Object.entries(servicesByName)) {
    const dbStripped = stripParens(dbName);
    if (dbStripped === stripped) return svc.id;
    // Also try plural variants of stripped forms
    if (dbStripped === stripped.replace(/s$/, '') || dbStripped + 's' === stripped) return svc.id;
  }

  // 4. Core-word overlap: extract significant words (3+ chars), match if ≥2 overlap
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from']);
  const getWords = (s) => s.replace(/[^a-z\s]/g, '').split(/\s+/)
    .filter(w => w.length >= 3 && !stopWords.has(w));
  const inputWords = getWords(lower);
  let bestMatch = null;
  let bestOverlap = 0;
  for (const [dbName, svc] of Object.entries(servicesByName)) {
    const dbWords = getWords(dbName);
    const overlap = inputWords.filter(w =>
      dbWords.some(dw => dw === w || dw.startsWith(w) || w.startsWith(dw))
    ).length;
    if (overlap >= 2 && overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = svc.id;
    }
  }
  if (bestMatch) return bestMatch;

  // 5. Substring match (either direction)
  for (const [dbName, svc] of Object.entries(servicesByName)) {
    if (dbName.includes(lower) || lower.includes(dbName)) {
      return svc.id;
    }
  }

  return null;
}

export async function deletePractice(id) {
  const { error } = await supabase
    .from('practices')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// --------------- Enquiries ---------------

export async function listEnquiries(practiceId, sortField) {
  let query = supabase
    .from('enquiries')
    .select('*')
    .eq('practice_id', practiceId);

  if (sortField) {
    const desc = sortField.startsWith('-');
    const field = desc ? sortField.slice(1) : sortField;
    query = query.order(field, { ascending: !desc });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createEnquiry(enquiryData) {
  const { data, error } = await supabase
    .from('enquiries')
    .insert(enquiryData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateEnquiry(id, updates) {
  const { data, error } = await supabase
    .from('enquiries')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteEnquiry(id) {
  const { error } = await supabase
    .from('enquiries')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// --------------- Email Events ---------------

/** Fetch email tracking events for an enquiry (for dashboard follow-up display). */
export async function listEmailEvents(enquiryId) {
  const { data, error } = await supabase
    .from('email_events')
    .select('id, email_type, recipient_email, subject, status, sent_at, delivered_at, opened_at, opened_count, clicked_at, clicked_count')
    .eq('enquiry_id', enquiryId)
    .order('sent_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/** Fetch all email events for a practice (overview). */
export async function listPracticeEmailEvents(practiceId, limit = 50) {
  const { data, error } = await supabase
    .from('email_events')
    .select('id, email_type, recipient_email, subject, status, sent_at, delivered_at, opened_at, opened_count, clicked_at, clicked_count, enquiry_id')
    .eq('practice_id', practiceId)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// --------------- Practitioners ---------------

/** Fetch all active practitioners for a practice, with their working hours. */
export async function listPractitioners(practiceId) {
  const { data, error } = await supabase
    .from('practitioners')
    .select('id, name, title, credentials, bio, working_hours')
    .eq('practice_id', practiceId)
    .order('name');

  if (error) throw error;
  return data || [];
}

// --------------- Appointments (diary) ---------------

/**
 * Fetch confirmed/pending appointments for a single day, joined with
 * practitioner name, service name + duration, and contact name + phone.
 * Returns everything the diary grid needs to render blocks.
 */
export async function listAppointmentsForDay(practiceId, dateStr) {
  // dateStr is "YYYY-MM-DD" — query the full day window in UTC
  const dayStart = `${dateStr}T00:00:00Z`;
  const dayEnd = `${dateStr}T23:59:59Z`;

  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id, starts_at, ends_at, status, notes, source,
      practitioner:practitioners ( id, name, title ),
      service:services ( id, name, duration_minutes ),
      contact:contacts ( id, name, phone )
    `)
    .eq('practice_id', practiceId)
    .in('status', ['confirmed', 'pending'])
    .gte('starts_at', dayStart)
    .lte('starts_at', dayEnd)
    .order('starts_at');

  if (error) throw error;
  return data || [];
}

// --------------- Appointment Requests ---------------

/**
 * Fetch pending/asap appointment requests awaiting team confirmation.
 * Joined with contact, service, and preferred practitioner for display.
 */
export async function listPendingRequests(practiceId) {
  const { data, error } = await supabase
    .from('appointment_requests')
    .select(`
      id, status, is_urgent, preferred_date, preferred_time,
      chosen_slot, notes, source, created_at,
      contact:contacts ( id, name, phone ),
      service:services ( id, name, duration_minutes ),
      preferred_practitioner:practitioners ( id, name )
    `)
    .eq('practice_id', practiceId)
    .in('status', ['pending', 'asap'])
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Confirm a pending request — creates an appointment row and updates
 * the request status to 'confirmed'. Returns the new appointment.
 */
export async function confirmAppointmentRequest(
  requestId,
  { practiceId, practitionerId, serviceId, contactId, startsAt, endsAt, source }
) {
  // 1. Create the confirmed appointment
  const { data: appointment, error: aptErr } = await supabase
    .from('appointments')
    .insert({
      practice_id: practiceId,
      practitioner_id: practitionerId,
      service_id: serviceId,
      contact_id: contactId || null,
      starts_at: startsAt,
      ends_at: endsAt,
      status: 'confirmed',
      source: source || 'phone',
    })
    .select()
    .single();

  if (aptErr) throw aptErr;

  // 2. Mark the request as confirmed
  const { error: reqErr } = await supabase
    .from('appointment_requests')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('id', requestId);

  if (reqErr) throw reqErr;

  // 3. Update the linked enquiry so the inbox shows green "Confirmed"
  await supabase
    .from('enquiries')
    .update({ appointment_status: 'confirmed', is_completed: true })
    .eq('appointment_request_id', requestId);

  return appointment;
}

/**
 * Update an appointment's status (e.g. cancel, complete, no-show).
 */
export async function updateAppointmentStatus(appointmentId, status) {
  const { data, error } = await supabase
    .from('appointments')
    .update({ status })
    .eq('id', appointmentId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
