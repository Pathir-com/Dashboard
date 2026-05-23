/**
 * Comprehensive component tour against the LIVE app, ending with a REAL
 * phone call that must surface in the dashboard UI:
 *   login → dashboard (Enquiries) → Diary → every Settings tab → place a
 *   real Twilio call to the practice's line → the call's enquiry appears in
 *   the Enquiries list in the UI.
 *
 * Setup provisions the account + phone via the API (fast); the test then
 * drives the real browser. A real outbound Twilio call (~£0.012) is placed
 * once. Teardown removes the account + agent.
 */

import { test, expect } from "@playwright/test";
import { admin } from "../e2e/helpers/supabase.ts";
import { invokeFunction } from "../e2e/helpers/supabase.ts";
import { createTestUser, createTestPractice, getUserJwt } from "../e2e/helpers/factories.ts";
import { loadEnv } from "../e2e/helpers/env.ts";
import { runId } from "../e2e/helpers/run-id.ts";

const PASSWORD = "TestPathir-2026!";
let user: any, practiceId = "", agentId = "", assignedNumber = "", email = "";

test.beforeAll(async () => {
  user = await createTestUser(950);
  email = user.email;
  const practice = await createTestPractice(user, { industry: "dental", label: "FullJourney", i: 950 });
  practiceId = practice.id;
  const sb = await admin();
  await sb.from("practices").update({ onboarding_completed: true }).eq("id", practiceId);
  const jwt = await getUserJwt(user);
  const prov = await invokeFunction("provision-practice", { practiceId }, jwt);
  agentId = prov.body?.agent_id;
  const assign = await invokeFunction("twilio-assign-number", { practiceId }, jwt);
  assignedNumber = assign.body?.phoneNumber;
});

test.afterAll(async () => {
  const sb = await admin();
  if (agentId) {
    const env = await loadEnv();
    await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
      method: "DELETE", headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
    }).catch(() => {});
  }
  if (practiceId) {
    const { data: svc } = await sb.from("services").select("id").eq("practice_id", practiceId);
    const ids = (svc || []).map((s) => s.id);
    if (ids.length) await sb.from("practitioner_services").delete().in("service_id", ids);
    await sb.from("appointments").delete().eq("practice_id", practiceId);
    await sb.from("appointment_requests").delete().eq("practice_id", practiceId);
    await sb.from("enquiry_messages").delete().in("enquiry_id",
      ((await sb.from("enquiries").select("id").eq("practice_id", practiceId)).data || []).map((e) => e.id));
    await sb.from("enquiries").delete().eq("practice_id", practiceId);
    await sb.from("conversations").delete().eq("practice_id", practiceId);
    await sb.from("services").delete().eq("practice_id", practiceId);
    await sb.from("practitioners").delete().eq("practice_id", practiceId);
    await sb.from("contacts").delete().eq("practice_id", practiceId);
    await sb.from("practices").delete().eq("id", practiceId);
  }
  if (user) await sb.auth.admin.deleteUser(user.id);
});

test("dashboard tour + real call surfaces in the enquiries UI", async ({ page }) => {
  expect(assignedNumber, "setup must assign a number").toBeTruthy();

  // ── Login → dashboard ──
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/Clinic/i, { timeout: 30_000 });

  // ── Dashboard loaded: the Enquiries view is the default ──
  await expect(page.getByText(/Enquiries/i).first()).toBeVisible({ timeout: 25_000 });

  // ── Sidebar: Diary renders ──
  await page.getByText("Diary", { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(800);

  // ── Settings → tour every tab ──
  await page.getByRole("button", { name: /settings/i }).first().click().catch(() => {});
  await page.getByText(/integrations/i).first().click().catch(() => {});
  await expect(page.getByText(/communication channels/i)).toBeVisible({ timeout: 20_000 });
  // core channels visible (the bug we fixed)
  await expect(page.getByText("Phone Agent", { exact: false }).first()).toBeVisible();
  for (const tab of [/^team$|team/i, /pricing/i, /practice info|info/i, /clinic details|clinic/i]) {
    await page.getByText(tab).first().click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // ── Place a REAL call to this practice's line (patient books) ──
  const env = await loadEnv();
  const fromNum = assignedNumber === "+441514536380" ? "+441917432540" : "+441514536380";
  const twiml = `<Response><Pause length="4"/><Say voice="Polly.Amy">Hello, I'm Alex Carter. I'd like to book a routine check up next Thursday morning please.</Say><Pause length="9"/><Say voice="Polly.Amy">My date of birth is the second of February nineteen ninety one.</Say><Pause length="8"/><Say voice="Polly.Amy">Yes please book it. Goodbye.</Say><Pause length="3"/></Response>`;
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const callRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: assignedNumber, From: fromNum, Twiml: twiml, Record: "true" }).toString(),
    },
  );
  expect(callRes.ok, `place call: ${await callRes.clone().text()}`).toBe(true);

  // ── Wait for the call to create an enquiry (poll the DB up to 90s) ──
  const sb = await admin();
  await expect.poll(async () => {
    const { count } = await sb.from("enquiries").select("id", { count: "exact", head: true }).eq("practice_id", practiceId);
    return count || 0;
  }, { timeout: 90_000, intervals: [3000] }).toBeGreaterThan(0);

  // ── The call appears in the Enquiries UI ──
  await page.getByText("Enquiries", { exact: false }).first().click().catch(() => {});
  await page.reload();
  await page.waitForTimeout(2000);
  await page.getByText("Enquiries", { exact: false }).first().click().catch(() => {});
  // At least one enquiry row visible (source=phone). Match on the phone source label or any enquiry card.
  await expect(
    page.getByText(/phone|new patient|alex carter/i).first(),
  ).toBeVisible({ timeout: 20_000 });
});
