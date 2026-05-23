/**
 * ensurePhoneRegisteredToAgent — the third layer of the voice flow.
 *
 * A working inbound call needs THREE things aligned:
 *   1. Twilio number voice_url -> ElevenLabs   (twilio-assign-number)
 *   2. ElevenLabs agent has the right prompt    (provision / backfill)
 *   3. ElevenLabs phone-number registered to THIS practice's agent  ← here
 *
 * Layer 3 was the silent killer: numbers get recycled between clients, but
 * the ElevenLabs phone-number record kept its old label + agent (e.g.
 * Berkeley's numbers still pointed at "Antrim House" / no agent). The call
 * reached ElevenLabs and then landed on the wrong agent or none.
 *
 * This makes the registration converge to the correct agent:
 *   - not registered  -> create it
 *   - registered to a different / no agent -> PATCH agent_id + label
 *   - already correct -> no-op
 *
 * Used by twilio-assign-number (enabling phone) and backfill-practices
 * (healing existing practices). Idempotent.
 */

const EL = "https://api.elevenlabs.io/v1/convai/phone-numbers";

export interface PhoneRegResult {
  action: "created" | "reassigned" | "already_correct" | "error" | "skipped";
  phone_number_id?: string;
  ok: boolean;
  detail?: string;
}

export async function ensurePhoneRegisteredToAgent(opts: {
  elevenLabsApiKey: string;
  phoneNumber: string;
  agentId: string;
  label: string;
  twilioSid: string;
  twilioToken: string;
}): Promise<PhoneRegResult> {
  const { elevenLabsApiKey, phoneNumber, agentId, label, twilioSid, twilioToken } = opts;
  if (!elevenLabsApiKey || !phoneNumber || !agentId) {
    return { action: "skipped", ok: false, detail: "missing api key / number / agent" };
  }
  const h = { "xi-api-key": elevenLabsApiKey, "Content-Type": "application/json" };

  // Find an existing registration for this number.
  const listRes = await fetch(EL, { headers: { "xi-api-key": elevenLabsApiKey } });
  if (!listRes.ok) {
    return { action: "error", ok: false, detail: `list ${listRes.status}` };
  }
  const list = await listRes.json();
  const rows = Array.isArray(list) ? list : (list.phone_numbers || []);
  // deno-lint-ignore no-explicit-any
  const matches = rows.filter((p: any) => p.phone_number === phoneNumber);

  if (matches.length > 0) {
    /* De-duplicate: repeated provisioning can leave several ElevenLabs
       phone-number records for the same E.164 (some assigned, some not),
       which makes routing + the audit non-deterministic. Keep ONE — prefer
       one already on the correct agent — point it at the right agent, and
       delete the rest so exactly one canonical record remains. */
    // deno-lint-ignore no-explicit-any
    const keep = matches.find((p: any) => (p.assigned_agent || {}).agent_id === agentId) || matches[0];
    const dupes = matches.filter((p: { phone_number_id: string }) => p.phone_number_id !== keep.phone_number_id);
    for (const d of dupes) {
      await fetch(`${EL}/${d.phone_number_id}`, { method: "DELETE", headers: { "xi-api-key": elevenLabsApiKey } }).catch(() => {});
    }

    const currentAgent = (keep.assigned_agent || {}).agent_id || null;
    if (currentAgent === agentId && dupes.length === 0) {
      return { action: "already_correct", ok: true, phone_number_id: keep.phone_number_id };
    }
    const r = await fetch(`${EL}/${keep.phone_number_id}`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ agent_id: agentId, label }),
    });
    return {
      action: dupes.length > 0 ? "deduped_and_reassigned" : "reassigned",
      ok: r.ok,
      phone_number_id: keep.phone_number_id,
      detail: r.ok ? `was ${currentAgent || "none"}, removed ${dupes.length} dupe(s)` : (await r.text()).slice(0, 200),
    };
  }

  // Not registered yet — create it. ElevenLabs' current import-Twilio API
  // takes top-level `sid` + `token` (Twilio account SID + auth token); the
  // older nested `twilio_config` shape now 422s with "sid Field required".
  const r = await fetch(`${EL}/create`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      phone_number: phoneNumber,
      provider: "twilio",
      label,
      agent_id: agentId,
      sid: twilioSid,
      token: twilioToken,
    }),
  });
  return {
    action: "created",
    ok: r.ok,
    detail: r.ok ? undefined : (await r.text()).slice(0, 200),
  };
}
