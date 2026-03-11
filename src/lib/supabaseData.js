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
  return data;
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

// --------------- Practitioners ---------------

/** Fetch all active practitioners for a practice, with their working hours. */
export async function listPractitioners(practiceId) {
  const { data, error } = await supabase
    .from('practitioners')
    .select('id, name, title, credentials, working_hours')
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
