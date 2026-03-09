import { createClient } from "@supabase/supabase-js";
import { getContactHistory } from "./_lib/match-contact.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Chatbase Action endpoint — called by Poppy mid-conversation.
 *
 * TWO uses:
 *   1. On page load:  ?practiceId=xxx  → get practice details (hours, prices, team)
 *   2. After collecting contact info:  ?practiceId=xxx&phone=xxx  → look up patient history
 *
 * Poppy calls #1 first to know the practice context.
 * Then once the patient gives their phone or email, Poppy calls #2
 * to check if they're a returning patient with previous conversations.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { practiceId, domain, phone, email } = req.query;

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

    // 3. Look up contact history if phone or email provided
    if (phone || email) {
      let contact = null;

      if (phone) {
        const { data } = await adminClient
          .from("contacts")
          .select("*")
          .eq("practice_id", resolvedPracticeId)
          .eq("phone", phone)
          .limit(1)
          .single();
        contact = data;
      }

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

        const channelsSeen = [...new Set(history.map(e => e.source))];
        const mostRecent = history[history.length - 1];
        const daysSince = Math.floor((Date.now() - new Date(mostRecent.created_at).getTime()) / 86400000);

        context.instructions_for_poppy = {
          step1_before_confirmation: `This MIGHT be a returning patient named "${contact.name}". `
            + `Ask: "I think we may have been in touch before — does the name ${contact.name} sound right?" `
            + `Do NOT reveal any health details, symptoms, or what they contacted about yet.`,

          step2_after_confirmation: `Once they confirm identity, say they "got in touch ${daysSince === 0 ? 'earlier today' : daysSince === 1 ? 'yesterday' : daysSince + ' days ago'}". `
            + `Ask: "Is this about the same thing, or something new?" `
            + `Do NOT mention specifics until they do.`,

          step3_after_they_restate: `Now you can use the conversation history below to help them. `
            + `Mirror what they say and add what you know — e.g. if they say "yeah the filling", `
            + `you can say "Of course — would today still work for you?" `
            + `Only reference details THEY have re-confirmed in this conversation.`,

          if_wrong_person: `If they say "no that's not me", apologise briefly and treat as a new patient. `
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
