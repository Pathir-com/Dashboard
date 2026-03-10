/**
 * Purpose:
 *     VAPI Server URL endpoint — called mid-conversation for tool calls.
 *     Handles identity verification, address updates, availability search,
 *     and appointment booking during live phone calls.
 *
 * Dependencies:
 *     - Supabase (contacts, practices, services, practitioners, appointments, appointment_requests)
 *     - api/_lib/practice-hours.js (hours status)
 *     - api/_lib/availability-search.js (slot search)
 *
 * Used by:
 *     - VAPI assistant (configured via Server URL in VAPI dashboard)
 *
 * Changes:
 *     2026-03-10: Added search_availability, request_appointment tools + practice_hours
 *     2026-03-10: Initial creation — lookup, verify, address tools
 */

import { createClient } from "@supabase/supabase-js";
import { getPracticeHoursStatus } from "./_lib/practice-hours.js";
import { searchAvailability } from "./_lib/availability-search.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    const payload = req.body.message || req.body;

    // Only handle tool-calls — acknowledge everything else
    if (payload.type !== "tool-calls" || !payload.toolCalls) {
      return res.json({ received: true });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const callInfo = req.body.message?.call || payload.call;
    const results = [];

    for (const toolCall of payload.toolCalls) {
      const fn = toolCall.function.name;
      const args = toolCall.function.arguments || {};

      // Inject caller phone from VAPI call context if not provided
      if (callInfo?.customer?.number && !args.caller_phone) {
        args.caller_phone = callInfo.customer.number;
      }

      let result;
      try {
        switch (fn) {
          case "lookup_caller_phone":
            result = await handleLookupCallerPhone(adminClient, args);
            break;
          case "lookup_account_phone":
            result = await handleLookupAccountPhone(adminClient, args);
            break;
          case "verify_identity":
            result = await handleVerifyIdentity(adminClient, args);
            break;
          case "update_address":
            result = await handleUpdateAddress(adminClient, args);
            break;
          case "search_availability":
            result = await handleSearchAvailability(adminClient, args);
            break;
          case "request_appointment":
            result = await handleRequestAppointment(adminClient, args);
            break;
          default:
            result = { success: false, message: `Unknown tool: ${fn}` };
        }
      } catch (err) {
        console.error(`[VAPI SERVER-URL] Error in ${fn}:`, err);
        result = { success: false, message: "Something went wrong. Please transfer to reception." };
      }

      results.push({
        toolCallId: toolCall.id,
        result: JSON.stringify(result),
      });
    }

    return res.json({ results });
  } catch (err) {
    console.error("[VAPI SERVER-URL ERROR]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

/**
 * lookup_caller_phone
 * Called automatically at the start of the call. Finds the practice by its
 * Twilio number, looks up the contact by caller phone, and includes
 * current practice hours status.
 */
async function handleLookupCallerPhone(db, args) {
  const { caller_phone, twilio_number } = args;

  if (!twilio_number) {
    return { success: false, message: "No practice number detected." };
  }

  // Find practice by Twilio number
  const { data: practice } = await db
    .from("practices")
    .select("id, name, opening_hours, holiday_hours")
    .eq("twilio_phone_number", twilio_number)
    .single();

  if (!practice) {
    return { success: false, message: "Practice not found." };
  }

  // Always include practice hours — the AI must never guess
  const practiceHours = getPracticeHoursStatus(
    practice.opening_hours,
    practice.holiday_hours
  );

  const base = {
    success: true,
    practice_id: practice.id,
    practice_name: practice.name,
    practice_hours: practiceHours,
  };

  // Look up contact by caller phone
  if (!caller_phone) {
    return { ...base, found: false, message: "No caller phone number available." };
  }

  const contact = await findContactByPhone(db, practice.id, caller_phone);

  if (contact) {
    return {
      ...base,
      found: true,
      contact_id: contact.id,
      contact_name: contact.name,
      contact_phone: contact.phone,
      contact_email: contact.email,
      contact_dob: contact.date_of_birth,
      contact_address: contact.address,
      contact_postcode: contact.postcode,
      message: `Account found for this phone number. Patient name on file: ${contact.name}.`,
    };
  }

  return { ...base, found: false, message: "No account linked to this phone number." };
}

/**
 * lookup_account_phone
 * Called when the caller's phone didn't match — they provide the phone on their account.
 */
async function handleLookupAccountPhone(db, args) {
  const { practice_id, account_phone } = args;

  if (!practice_id || !account_phone) {
    return { success: false, message: "Missing practice ID or phone number." };
  }

  const contact = await findContactByPhone(db, practice_id, account_phone);

  if (contact) {
    return {
      success: true,
      found: true,
      contact_id: contact.id,
      contact_name: contact.name,
      contact_phone: contact.phone,
      contact_email: contact.email,
      contact_dob: contact.date_of_birth,
      contact_address: contact.address,
      contact_postcode: contact.postcode,
      message: `Account found. Patient name on file: ${contact.name}.`,
    };
  }

  return {
    success: true,
    found: false,
    message: "No account found with that phone number either.",
  };
}

/**
 * verify_identity
 * Checks the caller's stated name and DOB against the contact on file.
 */
async function handleVerifyIdentity(db, args) {
  const { contact_id, stated_name, stated_dob } = args;

  if (!contact_id) {
    return { success: false, message: "No contact to verify against." };
  }

  const { data: contact } = await db
    .from("contacts")
    .select("id, name, date_of_birth, address, postcode")
    .eq("id", contact_id)
    .single();

  if (!contact) {
    return { success: false, message: "Contact not found." };
  }

  // Check name (case-insensitive, loose match)
  const nameOnFile = (contact.name || "").toLowerCase().trim();
  const nameStated = (stated_name || "").toLowerCase().trim();
  const nameMatch =
    nameOnFile === nameStated ||
    nameOnFile.includes(nameStated) ||
    nameStated.includes(nameOnFile);

  // Check DOB
  const dobOnFile = contact.date_of_birth;
  const dobMatch = dobOnFile && stated_dob && dobOnFile === stated_dob;

  if (!nameMatch) {
    return {
      success: true,
      verified: false,
      reason: "name_mismatch",
      message: "The name doesn't match what we have on file.",
    };
  }

  if (!dobOnFile) {
    // No DOB on file — accept the stated one and save it
    await db.from("contacts").update({ date_of_birth: stated_dob }).eq("id", contact_id);
    return {
      success: true,
      verified: true,
      dob_was_missing: true,
      contact_address: contact.address,
      contact_postcode: contact.postcode,
      message: "Name matches. Date of birth recorded. Identity verified.",
    };
  }

  if (!dobMatch) {
    return {
      success: true,
      verified: false,
      reason: "dob_mismatch",
      message: "The date of birth doesn't match what we have on file.",
    };
  }

  return {
    success: true,
    verified: true,
    contact_address: contact.address,
    contact_postcode: contact.postcode,
    message: "Identity verified successfully.",
  };
}

/**
 * update_address
 * Updates a contact's address and postcode.
 */
async function handleUpdateAddress(db, args) {
  const { contact_id, new_address, new_postcode } = args;

  if (!contact_id || !new_address) {
    return { success: false, message: "Missing contact ID or address." };
  }

  const updates = { address: new_address };
  if (new_postcode) updates.postcode = new_postcode;

  const { error } = await db.from("contacts").update(updates).eq("id", contact_id);

  if (error) {
    console.error("[UPDATE ADDRESS]", error);
    return { success: false, message: "Failed to update address." };
  }

  return { success: true, message: "Address updated successfully." };
}

/**
 * search_availability
 * Searches the diary for available appointment slots.
 */
async function handleSearchAvailability(db, args) {
  const { practice_id, service_name, preference_day, preference_time, preference_date, is_urgent } = args;

  if (!practice_id || !service_name) {
    return { success: false, message: "Missing practice ID or service name." };
  }

  // Fetch practice hours for the search
  const { data: practice } = await db
    .from("practices")
    .select("opening_hours, holiday_hours")
    .eq("id", practice_id)
    .single();

  if (!practice) {
    return { success: false, message: "Practice not found." };
  }

  const result = await searchAvailability(db, {
    practice_id,
    service_name,
    preference_day,
    preference_time,
    preference_date,
    is_urgent: is_urgent || false,
    opening_hours: practice.opening_hours || [],
    holiday_hours: practice.holiday_hours || [],
  });

  // Include hours status so the AI knows if practice is currently open
  const hoursStatus = getPracticeHoursStatus(
    practice.opening_hours,
    practice.holiday_hours
  );

  return {
    success: true,
    ...result,
    practice_hours: hoursStatus,
  };
}

/**
 * request_appointment
 * Creates a pending appointment request (or ASAP if urgent with no slot).
 */
async function handleRequestAppointment(db, args) {
  const {
    practice_id,
    contact_id,
    service_id,
    chosen_slot,
    backup_slot,
    is_urgent = false,
    source = "phone",
    notes,
  } = args;

  if (!practice_id) {
    return { success: false, message: "Missing practice ID." };
  }

  // Check if submitted outside hours
  const { data: practice } = await db
    .from("practices")
    .select("opening_hours, holiday_hours")
    .eq("id", practice_id)
    .single();

  const hoursStatus = practice
    ? getPracticeHoursStatus(practice.opening_hours, practice.holiday_hours)
    : { is_open_now: false };

  const outsideHours = !hoursStatus.is_open_now;
  const status = is_urgent && !chosen_slot ? "asap" : "pending";

  const requestNotes = [
    notes || "",
    outsideHours ? "[Submitted outside practice hours]" : "",
  ].filter(Boolean).join(" ").trim() || null;

  const { data: request, error } = await db
    .from("appointment_requests")
    .insert({
      practice_id,
      contact_id: contact_id || null,
      service_id: service_id || null,
      is_urgent,
      status,
      chosen_slot: chosen_slot || null,
      backup_slot: backup_slot || null,
      preferred_date: chosen_slot?.date || null,
      preferred_time: chosen_slot?.start_time || null,
      notes: requestNotes,
      submitted_outside_hours: outsideHours,
      source,
    })
    .select()
    .single();

  if (error) {
    console.error("[REQUEST APPOINTMENT]", error);
    return { success: false, message: "Failed to create appointment request." };
  }

  // Build response message
  let message;
  if (status === "asap") {
    message = outsideHours
      ? "I've put in an urgent request for you. The practice is currently closed but the team will see it as soon as they're in and get back to you."
      : "I've put in an urgent request for you. The team will see it and get back to you as soon as possible.";
  } else {
    message = "I've pencilled that in. The team will confirm and send you a text shortly.";
  }

  return {
    success: true,
    request_id: request.id,
    status,
    submitted_outside_hours: outsideHours,
    message,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find a contact by phone number (tries exact match, then normalised, then +44↔0).
 */
async function findContactByPhone(db, practiceId, phone) {
  const normalised = phone.replace(/[\s\-()]/g, "");
  const cols = "id, name, phone, email, date_of_birth, address, postcode";

  // Try exact match
  let { data: contact } = await db
    .from("contacts")
    .select(cols)
    .eq("practice_id", practiceId)
    .eq("phone", phone)
    .limit(1)
    .single();
  if (contact) return contact;

  // Try normalised
  if (normalised !== phone) {
    const { data } = await db
      .from("contacts").select(cols)
      .eq("practice_id", practiceId).eq("phone", normalised)
      .limit(1).single();
    if (data) return data;
  }

  // Try +44 ↔ 0 conversion
  const alt = phone.startsWith("+44")
    ? "0" + phone.slice(3)
    : phone.startsWith("0")
      ? "+44" + phone.slice(1)
      : null;

  if (alt) {
    const { data } = await db
      .from("contacts").select(cols)
      .eq("practice_id", practiceId).eq("phone", alt)
      .limit(1).single();
    if (data) return data;
  }

  return null;
}
