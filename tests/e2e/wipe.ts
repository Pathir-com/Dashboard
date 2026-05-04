/**
 * wipe.ts — full-test-state cleanup, run-id-tag scoped.
 *
 * Idempotent. Run as `npm run test:wipe`.
 *
 * Removes:
 *   - All Supabase auth users whose email starts with the test tag prefix
 *   - All practices whose name starts with the prefix (orphaned ones too)
 *   - All sms_trial_routes whose user_phone is in the +447700900xxx range
 *   - All ElevenLabs agents whose name contains the prefix
 *   - All Twilio number friendly_names that contain the prefix — reset to
 *     just the E.164 digits and clear voice/sms URL
 *
 * Does NOT release Twilio numbers (re-acquisition costs money). Run the
 * Twilio Console manually if a number is no longer wanted.
 */

import { admin } from "./helpers/supabase.ts";
import { listTestAgents, deleteAgent } from "./helpers/elevenlabs.ts";
import { listIncomingNumbers } from "./helpers/twilio.ts";
import { tagPrefix } from "./helpers/run-id.ts";
import { loadEnv } from "./helpers/env.ts";

const PREFIX = tagPrefix();
const FAKE_PHONE_RANGE = /^\+447700900\d{3}$/;

async function wipeUsers(): Promise<number> {
  const sb = await admin();
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) { console.error("listUsers:", error); return 0; }
  const targets = data.users.filter((u) => (u.email || "").startsWith(PREFIX));
  let n = 0;
  for (const u of targets) {
    /* delete owned practices first so FK cascade doesn't surprise us */
    await sb.from("practices").delete().eq("owner_id", u.id);
    await sb.auth.admin.deleteUser(u.id);
    n++;
  }
  console.log(`[wipe] users: deleted ${n}`);
  return n;
}

async function wipeOrphanPractices(): Promise<number> {
  const sb = await admin();
  const { data, error } = await sb
    .from("practices")
    .select("id, name")
    .ilike("name", `${PREFIX}%`);
  if (error) { console.error("orphan practices:", error); return 0; }
  if (!data || data.length === 0) {
    console.log("[wipe] orphan practices: 0");
    return 0;
  }
  await sb.from("practices").delete().in("id", data.map((p) => p.id));
  console.log(`[wipe] orphan practices: deleted ${data.length}`);
  return data.length;
}

async function wipeTrialRoutes(): Promise<number> {
  const sb = await admin();
  const { data } = await sb.from("sms_trial_routes").select("user_phone");
  const targets = (data || []).filter((r) => FAKE_PHONE_RANGE.test(r.user_phone));
  if (targets.length > 0) {
    await sb
      .from("sms_trial_routes")
      .delete()
      .in("user_phone", targets.map((r) => r.user_phone));
  }
  console.log(`[wipe] trial routes: deleted ${targets.length}`);
  return targets.length;
}

async function wipeAgents(): Promise<number> {
  const targets = await listTestAgents();
  for (const a of targets) {
    try { await deleteAgent(a.agent_id); } catch (e) { console.error("agent delete:", e); }
  }
  console.log(`[wipe] elevenlabs agents: deleted ${targets.length}`);
  return targets.length;
}

async function wipeTwilioFriendlyNames(): Promise<number> {
  const env = await loadEnv();
  const all = await listIncomingNumbers();
  /* Look for the test prefix anywhere in the friendly_name. The
     twilio-assign-number function sets it to "Pathir - <practice.name>";
     practice names from tests start with the prefix. */
  const targets = all.filter((n) => n.friendly_name.includes(PREFIX));
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  for (const n of targets) {
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/${n.sid}.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          FriendlyName: n.phone_number.replace(/^\+/, ""),
          VoiceUrl: "",
          SmsUrl: "",
        }).toString(),
      },
    );
  }
  console.log(`[wipe] twilio friendly_names reset: ${targets.length}`);
  return targets.length;
}

async function main() {
  console.log(`[wipe] tag prefix: ${PREFIX}`);
  const summary = {
    users: await wipeUsers(),
    orphanPractices: await wipeOrphanPractices(),
    trialRoutes: await wipeTrialRoutes(),
    agents: await wipeAgents(),
    twilioNumbers: await wipeTwilioFriendlyNames(),
  };
  console.log("[wipe] done:", summary);
}

main().catch((e) => { console.error(e); process.exit(1); });
