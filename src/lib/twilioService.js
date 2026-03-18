/**
 * Twilio Service Client
 *
 * Purpose: Manages Twilio phone number assignment and agent toggling for practices.
 * Dependencies: @/lib/supabase, Supabase Edge Functions (twilio-assign-number, twilio-toggle-number)
 * Used by: Practice settings / phone configuration components
 * Changes:
 *   2026-03-18: Replaced releaseTwilioNumber with togglePhoneAgent for permanent number assignment
 */

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

/**
 * Toggle the phone agent on or off for a practice's assigned number.
 *
 * @param {string} practiceId - The practice to toggle
 * @param {boolean} enable - Whether to enable (true) or disable (false) the agent
 * @returns {Promise<object>} Response from the edge function
 */
export async function togglePhoneAgent(practiceId, enable) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${API_BASE}/twilio-toggle-number`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ practiceId, enable }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to toggle phone agent');
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
