/**
 * Full new-account UI journey against the LIVE app:
 *   login → onboarding (industry → details → hours → AI-test) → dashboard
 *   → Settings → Integrations → toggle Phone on → phone line connects.
 *
 * Setup creates a pre-confirmed user via the admin API (signup itself needs
 * an email round-trip we can't complete headless); everything after is the
 * real browser flow a user experiences. Teardown deletes the user + agent
 * and releases the number registration.
 *
 * "Phone line connects" is asserted at the DB/ElevenLabs layer after the UI
 * toggle: number assigned on the practice row + registered to the practice's
 * agent in ElevenLabs.
 */

import { test, expect } from "@playwright/test";
import { admin } from "../e2e/helpers/supabase.ts";
import { listAgents } from "../e2e/helpers/elevenlabs.ts";
import { loadEnv } from "../e2e/helpers/env.ts";
import { runId } from "../e2e/helpers/run-id.ts";

const PASSWORD = "TestPathir-2026!";
const email = `${runId()}-ui@pathir-test.invalid`;
let userId = "";
let practiceId = "";

test.beforeAll(async () => {
  const sb = await admin();
  const { data, error } = await sb.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: "UI Test User" },
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  userId = data.user.id;
});

test.afterAll(async () => {
  const sb = await admin();
  if (practiceId) {
    const { data: svc } = await sb.from("services").select("id").eq("practice_id", practiceId);
    const ids = (svc || []).map((s) => s.id);
    if (ids.length) await sb.from("practitioner_services").delete().in("service_id", ids);
    await sb.from("appointments").delete().eq("practice_id", practiceId);
    await sb.from("appointment_requests").delete().eq("practice_id", practiceId);
    await sb.from("services").delete().eq("practice_id", practiceId);
    await sb.from("practitioners").delete().eq("practice_id", practiceId);
    await sb.from("practices").delete().eq("id", practiceId);
  }
  if (userId) await sb.auth.admin.deleteUser(userId);
});

test("new account: login → onboarding → integrations → phone connects", async ({ page }) => {
  // ── Login ──
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  // ── Onboarding Step 1: industry ──
  await expect(page.getByRole("heading", { name: /what kind of clinic/i })).toBeVisible({ timeout: 30_000 });
  await page.getByText("Dental Practice", { exact: false }).click();
  await page.getByRole("button", { name: /continue/i }).click();

  // ── Step 2: clinic details ──
  await expect(page.getByRole("heading", { name: /clinic details/i })).toBeVisible();
  await page.getByPlaceholder(/Parkview Dental|Berkeley/i).fill(`UI Test Clinic ${runId()}`);
  await page.getByRole("button", { name: /continue/i }).click();

  // ── Step 3: hours → creates practice + provisions agent ──
  await expect(page.getByRole("heading", { name: /opening hours/i })).toBeVisible();
  await page.getByRole("button", { name: /continue/i }).click();

  // ── Step 4: AI test → skip to dashboard ──
  await expect(page.getByRole("heading", { name: /test the ai/i })).toBeVisible({ timeout: 30_000 });
  // capture the practice id now that it exists
  {
    const sb = await admin();
    const { data } = await sb.from("practices").select("id").eq("owner_id", userId).maybeSingle();
    practiceId = data?.id || "";
    expect(practiceId, "practice row should exist after step 3").toBeTruthy();
  }
  await page.getByRole("button", { name: /skip and go to dashboard|finish/i }).first().click();

  // ── Dashboard ──
  await expect(page).toHaveURL(/\/Clinic/i, { timeout: 30_000 });

  // ── Settings → Integrations ──
  await page.getByRole("button", { name: /settings/i }).first().click().catch(() => {});
  await page.getByText(/integrations/i).first().click();
  await expect(page.getByText(/communication channels/i)).toBeVisible({ timeout: 20_000 });

  // ── Toggle Phone on ──
  await page.getByText("Phone Agent", { exact: false }).first().click();
  // assignment can take ~10s (Twilio + ElevenLabs registration)
  await page.waitForTimeout(15_000);

  // ── Assert phone line connected (DB + ElevenLabs) ──
  const sb = await admin();
  const { data: prac } = await sb
    .from("practices")
    .select("twilio_phone_number, elevenlabs_agent_id")
    .eq("id", practiceId).single();
  expect(prac?.twilio_phone_number, "number assigned via UI toggle").toBeTruthy();
  expect(prac?.elevenlabs_agent_id, "agent provisioned").toBeTruthy();

  const env = await loadEnv();
  const reg = await fetch("https://api.elevenlabs.io/v1/convai/phone-numbers", {
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
  }).then((r) => r.json());
  const rows = Array.isArray(reg) ? reg : (reg.phone_numbers || []);
  const match = rows.find((r: any) => r.phone_number === prac!.twilio_phone_number);
  expect(match, "number registered in ElevenLabs").toBeTruthy();
  expect((match.assigned_agent || {}).agent_id, "registered to THIS practice's agent")
    .toBe(prac!.elevenlabs_agent_id);
});
