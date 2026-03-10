import { createClient } from "@supabase/supabase-js";
import { getContactHistory } from "./_lib/match-contact.js";
import { getPracticeHoursStatus } from "./_lib/practice-hours.js";
import { searchAvailability } from "./_lib/availability-search.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Purpose:
 *     Chatbase Action endpoint — called by Poppy mid-conversation.
 *
 * Dependencies:
 *     - Supabase (practices, contacts, enquiries, services, appointments, appointment_requests)
 *     - api/_lib/match-contact.js (contact history)
 *     - api/_lib/practice-hours.js (hours status)
 *     - api/_lib/availability-search.js (slot search)
 *
 * Used by:
 *     - Chatbase chatbot (Poppy) via action URL
 *
 * GET uses:
 *   1. On page load:  ?practiceId=xxx  → practice details (hours, prices, team)
 *   2. Contact lookup: ?practiceId=xxx&phone=xxx  → patient + verify flow
 *   3. Availability:   ?practiceId=xxx&searchAvailability=true&service=checkup&day=thursday&time=morning
 *
 * POST uses:
 *   4. Update address:  { action: "update_address", contact_id, new_address, new_postcode }
 *   5. Request appt:    { action: "request_appointment", practice_id, contact_id, service_id, chosen_slot, is_urgent }
 *
 * Changes:
 *     2026-03-10: Added booking actions, hours status, availability search
 *     2026-03-10: Added identity verification + address check flow
 *     2026-03-10: Initial creation
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // POST — address update or appointment request
  if (req.method === "POST") {
    return handlePost(req, res);
  }

  try {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { practiceId, domain, phone, email, searchAvailability: searchAvail, service, day, time, date, urgent } = req.query;

    // 1. Find practice
    let practice;
    let resolvedPracticeId;

    if (practiceId) {
      const { data } = await adminClient
        .from("practices")
        .select("id, name, address, phone, email, website, practice_type, opening_hours, holiday_hours, practitioners, price_list, usps, practice_plan")
        .eq("id", practiceId)
        .single();
      practice = data;
      resolvedPracticeId = practiceId;
    } else if (domain) {
      const { data } = await adminClient
        .from("practices")
        .select("id, name, address, phone, email, website, practice_type, opening_hours, holiday_hours, practitioners, price_list, usps, practice_plan")
        .ilike("website", `%${domain}%`)
        .limit(1)
        .single();
      practice = data;
      resolvedPracticeId = data?.id;
    }

    if (!practice) {
      return res.status(404).json({ message: "Practice not found" });
    }

    // 2. Format practice context
    const context = {
      practice_name: practice.name,
      address: practice.address,
      phone: practice.phone,
      email: practice.email,
      website: practice.website,
      type: practice.practice_type,
      opening_hours: (practice.opening_hours || [])
        .map(h => `${h.day}: ${h.is_open ? `${h.open_time}–${h.close_time}` : 'Closed'}`)
        .join("\n"),
      team: (practice.practitioners || [])
        .map(p => `${p.title || ''} ${p.name} — ${p.credentials || ''} (${(p.services || []).join(", ")})`)
        .join("\n"),
      prices: (practice.price_list || [])
        .map(p => `${p.service_name}: £${p.price}${p.notes ? ` (${p.notes})` : ''}`)
        .join("\n"),
      about: practice.usps || "",
      practice_plan: practice.practice_plan?.offered
        ? practice.practice_plan.terms
        : "No practice plan offered",
    };

    // Include current practice hours status
    context.practice_hours = getPracticeHoursStatus(
      practice.opening_hours,
      practice.holiday_hours
    );

    // 2b. Handle availability search if requested
    if (searchAvail === "true" && service) {
      const availResult = await searchAvailability(adminClient, {
        practice_id: resolvedPracticeId,
        service_name: service,
        preference_day: day || null,
        preference_time: time || null,
        preference_date: date || null,
        is_urgent: urgent === "true",
        opening_hours: practice.opening_hours || [],
        holiday_hours: practice.holiday_hours || [],
      });

      context.availability = availResult;
      context.instructions_for_poppy_booking = {
        presenting_slots:
          availResult.slots.length > 0
            ? `Present these options to the patient using practitioner first names only:\n`
              + availResult.slots.map((s, i) => `${i + 1}. ${s.display}`).join("\n")
              + `\nAsk which works best, or if they'd like to see other dates.`
            : `No slots found. ${availResult.message}`,

        after_patient_chooses:
          `Once they choose a slot, create the booking by POSTing to this URL with:\n`
          + `{ "action": "request_appointment", "practice_id": "${resolvedPracticeId}", "contact_id": "[their contact_id]", `
          + `"service_id": "${availResult.slots[0]?.service_id || ""}", `
          + `"chosen_slot": { "practitioner_id": "...", "date": "...", "start_time": "...", "end_time": "..." }, `
          + `"is_urgent": ${urgent === "true"} }\n`
          + `Then say: "I've pencilled that in for you. The team will confirm and send you a text shortly."`,

        no_slots_urgent:
          urgent === "true" && availResult.slots.length === 0
            ? `No slots found for an urgent request. POST an ASAP request:\n`
              + `{ "action": "request_appointment", "practice_id": "${resolvedPracticeId}", "contact_id": "[their contact_id]", `
              + `"is_urgent": true }\n`
              + (context.practice_hours.is_open_now
                ? `Say: "I'm not finding anything in the next week. I've put in an urgent request — the team will get back to you as soon as possible. If you'd rather speak to someone now I can give you the number."`
                : `Say: "The practice is currently closed. I've put in an urgent request — the team will see it as soon as they're in and get back to you."`)
            : null,
      };

      return res.json(context);
    }

    // 3. Look up contact if phone or email provided
    if (phone || email) {
      let contact = null;

      // Try phone (with normalisation for +44 / 0 prefix)
      if (phone) {
        contact = await findContactByPhone(adminClient, resolvedPracticeId, phone);
      }

      // Fallback to email
      if (!contact && email) {
        const { data } = await adminClient
          .from("contacts")
          .select("*")
          .eq("practice_id", resolvedPracticeId)
          .eq("email", email)
          .limit(1)
          .single();
        contact = data;
      }

      if (contact) {
        const history = await getContactHistory(adminClient, contact.id);

        context.returning_patient = true;
        context.patient_name = contact.name;
        context.contact_id = contact.id;

        // Identity fields for verification
        context.contact_dob = contact.date_of_birth || null;
        context.contact_address = contact.address || null;
        context.contact_postcode = contact.postcode || null;

        // Give Poppy the full conversation details so she can reference specifics
        context.previous_interactions = history.map(e => {
          const channelLabel = { phone: "Phone call", sms: "Text message", chat: "Web chat", email: "Email", facebook: "Facebook", instagram: "Instagram" }[e.source] || e.source;
          const date = new Date(e.created_at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
          const time = new Date(e.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

          // Full conversation transcript
          const transcript = (e.conversation || [])
            .map(m => `  ${m.role === "agent" ? "Poppy" : contact.name}: ${m.message}`)
            .join("\n");

          return `[${date} at ${time} via ${channelLabel}]\nSummary: ${e.message}\nStatus: ${e.is_completed ? "Completed" : "Open"}\nFull conversation:\n${transcript || "  (no transcript)"}`;
        }).join("\n\n---\n\n");

        const mostRecent = history.length > 0 ? history[history.length - 1] : null;
        const daysSince = mostRecent
          ? Math.floor((Date.now() - new Date(mostRecent.created_at).getTime()) / 86400000)
          : null;

        context.instructions_for_poppy = {
          step1_verify_identity:
            `An account was found for this phone number. The name on file is "${contact.name}". `
            + `You need to verify their identity before proceeding.\n\n`
            + `Ask: "I've found your account. Could I get your full name please?"\n`
            + `Once they tell you, just say "Thank you [their first name]." and move to the next question. `
            + `They just told you their name — do not read the full name back, do not ask them to confirm it. `
            + `Always use their first name only, never their full name.\n\n`
            + `Then: "And your date of birth?"\n\n`
            + `Compare what they say against the name and DOB on file. `
            + (contact.date_of_birth
              ? `The DOB on file is ${contact.date_of_birth}. `
              : `There is no DOB on file — accept whatever they give. `)
            + `If the name matches (even loosely) and DOB matches (or wasn't on file), identity is verified. `
            + `Use their first name only for the rest of the conversation.\n`
            + `If either doesn't match after two attempts, say: "I'm not able to verify your identity — let me put you through to the team. You can reach us on ${practice.phone || 'our main number'}."`,

          step2_address_check:
            `Once identity is verified, ask: "And could I get your address please?"\n\n`
            + (contact.postcode
              ? `The postcode on file is "${contact.postcode}". `
                + `Compare the postcode they give with this. `
                + `If it MATCHES → "Perfect, thank you." and move on.\n`
                + `If it's DIFFERENT → "We have ${contact.postcode} on file. Have you recently changed address? Should we update it?"\n`
                + `If they say YES → "Could you give me the full new address including postcode?" `
                + `Then call the update endpoint (POST to this URL with { contact_id: "${contact.id}", new_address: "...", new_postcode: "..." }) `
                + `and say: "That's been updated for you."\n`
                + `If they say NO → "No worries." and move on.`
              : (contact.address
                ? `The address on file is "${contact.address}". Compare and handle the same way.`
                : `There is no address on file. Whatever they give, save it by calling the update endpoint `
                  + `(POST to this URL with { contact_id: "${contact.id}", new_address: "...", new_postcode: "..." }). `
                  + `Say: "Thank you, I've got that noted down."`)),

          step3_after_verification:
            daysSince !== null
              ? `Once verified, say they "got in touch ${daysSince === 0 ? 'earlier today' : daysSince === 1 ? 'yesterday' : daysSince + ' days ago'}". `
                + `Ask: "Is this about the same thing, or something new?" `
                + `Do NOT mention specifics until they do.`
              : `Once verified, ask: "How can I help you today?"`,

          step4_use_history:
            `After they state their reason, you can use the conversation history below to help them. `
            + `Mirror what they say and add what you know — e.g. if they say "yeah the filling", `
            + `you can say "Of course — would today still work for you?" `
            + `Only reference details THEY have re-confirmed in this conversation.`,

          step5_booking:
            `If the patient wants to book an appointment, ask what type of appointment they need and when they'd prefer.\n`
            + `Then search for availability by calling this URL with: `
            + `?practiceId=${resolvedPracticeId}&searchAvailability=true&service=[service]&day=[day]&time=[time]&urgent=[true/false]\n`
            + `Present the options using practitioner first names only. When they choose, POST the booking.\n`
            + `Always say "pencilled in" — never say "confirmed". The team confirms and texts them.`,

          if_wrong_person:
            `If they say "no that's not me" at any point, apologise briefly and treat as a new patient. `
            + `Say: "No worries at all! I'm here to help — what can I do for you today?"`,
        };
      } else {
        context.returning_patient = false;
      }
    }

    return res.json(context);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * POST handler — dispatches to address update or appointment request.
 */
async function handlePost(req, res) {
  const action = req.body.action || "update_address";

  switch (action) {
    case "update_address":
      return handleAddressUpdate(req, res);
    case "request_appointment":
      return handleRequestAppointment(req, res);
    default:
      return res.status(400).json({ message: `Unknown action: ${action}` });
  }
}

/**
 * Update a contact's address from chat.
 */
async function handleAddressUpdate(req, res) {
  try {
    const { contact_id, new_address, new_postcode } = req.body;

    if (!contact_id || !new_address) {
      return res.status(400).json({ message: "contact_id and new_address are required" });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const updates = { address: new_address };
    if (new_postcode) updates.postcode = new_postcode;

    const { error } = await adminClient
      .from("contacts")
      .update(updates)
      .eq("id", contact_id);

    if (error) {
      console.error("[CHATBASE ACTION] Address update failed:", error);
      return res.status(500).json({ message: "Failed to update address" });
    }

    return res.json({ success: true, message: "Address updated" });
  } catch (err) {
    console.error("[CHATBASE ACTION] Address update error:", err);
    return res.status(500).json({ message: err.message });
  }
}

/**
 * Create an appointment request from chat.
 */
async function handleRequestAppointment(req, res) {
  try {
    const { practice_id, contact_id, service_id, chosen_slot, backup_slot, is_urgent, notes } = req.body;

    if (!practice_id) {
      return res.status(400).json({ message: "practice_id is required" });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check if submitted outside hours
    const { data: practice } = await adminClient
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

    const { data: request, error } = await adminClient
      .from("appointment_requests")
      .insert({
        practice_id,
        contact_id: contact_id || null,
        service_id: service_id || null,
        is_urgent: is_urgent || false,
        status,
        chosen_slot: chosen_slot || null,
        backup_slot: backup_slot || null,
        preferred_date: chosen_slot?.date || null,
        preferred_time: chosen_slot?.start_time || null,
        notes: requestNotes,
        submitted_outside_hours: outsideHours,
        source: "chat",
      })
      .select()
      .single();

    if (error) {
      console.error("[CHATBASE ACTION] Appointment request failed:", error);
      return res.status(500).json({ message: "Failed to create appointment request" });
    }

    return res.json({
      success: true,
      request_id: request.id,
      status,
      submitted_outside_hours: outsideHours,
    });
  } catch (err) {
    console.error("[CHATBASE ACTION] Appointment request error:", err);
    return res.status(500).json({ message: err.message });
  }
}

/**
 * Find a contact by phone number with UK normalisation (+44 ↔ 0).
 */
async function findContactByPhone(db, practiceId, phone) {
  const normalised = phone.replace(/[\s\-()]/g, "");

  // Try exact
  let { data: contact } = await db
    .from("contacts")
    .select("*")
    .eq("practice_id", practiceId)
    .eq("phone", phone)
    .limit(1)
    .single();
  if (contact) return contact;

  // Try normalised
  if (normalised !== phone) {
    const { data } = await db
      .from("contacts")
      .select("*")
      .eq("practice_id", practiceId)
      .eq("phone", normalised)
      .limit(1)
      .single();
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
      .from("contacts")
      .select("*")
      .eq("practice_id", practiceId)
      .eq("phone", alt)
      .limit(1)
      .single();
    if (data) return data;
  }

  return null;
}
