/**
 * Supabase data layer — replaces localStorage for logged-in users.
 * Provides the same API surface as base44Client.js but reads/writes Supabase.
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
