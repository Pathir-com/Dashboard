import { supabase } from '@/lib/supabase';

const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export async function assignTwilioNumber(practiceId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${API_BASE}/twilio-assign-number`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ practiceId }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to assign number');
  }

  return res.json();
}

export async function releaseTwilioNumber(practiceId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${API_BASE}/twilio-release-number`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ practiceId }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to release number');
  }

  return res.json();
}

export async function getAssignedTwilioNumber(practiceId) {
  // Read directly from Supabase — no API needed
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('practices')
    .select('twilio_phone_number')
    .eq('id', practiceId)
    .single();

  if (error) throw new Error(error.message);
  return { phoneNumber: data?.twilio_phone_number || null };
}
