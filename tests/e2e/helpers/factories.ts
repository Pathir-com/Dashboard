/**
 * Test data factories. Each factory returns a fully-formed resource that
 * can later be wiped via the run-id tag.
 */

import { admin, userClient } from "./supabase.ts";
import { runId, testEmail, testPracticeName } from "./run-id.ts";

const PASSWORD = "TestPathir-2026!";

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export interface TestPractice {
  id: string;
  name: string;
  industry: string;
  owner_id: string;
}

/** Create a fresh test user via Supabase admin. Email-confirmed so we can
 *  sign in immediately without a verification round-trip. */
export async function createTestUser(i: number = 0): Promise<TestUser> {
  const sb = await admin();
  const email = testEmail(i);
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Test User ${i} (${runId()})` },
  });
  if (error || !data.user) throw new Error(`createTestUser: ${error?.message}`);
  return { id: data.user.id, email, password: PASSWORD };
}

/** Create a practice owned by `user`. Industry defaults to dental.
 *  Returns the freshly-inserted row. */
export async function createTestPractice(
  user: TestUser,
  opts: { industry?: "dental" | "hair_transplant"; label?: string; i?: number } = {},
): Promise<TestPractice> {
  const sb = await admin();
  const industry = opts.industry || "dental";
  const name = testPracticeName(opts.i ?? 0, opts.label || (industry === "hair_transplant" ? "Hair Clinic" : "Dental"));

  const { data, error } = await sb
    .from("practices")
    .insert({
      name,
      address: "1 Test Street, London",
      email: user.email,
      website: "https://example.com",
      practice_type: "Private",
      industry,
      owner_id: user.id,
      onboarding_completed: false,
      opening_hours: [
        { day: "Monday", is_open: true, open_time: "09:00", close_time: "17:30" },
        { day: "Tuesday", is_open: true, open_time: "09:00", close_time: "17:30" },
      ],
    })
    .select()
    .single();

  if (error || !data) throw new Error(`createTestPractice: ${error?.message}`);
  return { id: data.id, name: data.name, industry: data.industry, owner_id: data.owner_id };
}

/** Sign in as the given user and return a Supabase client carrying their JWT. */
export async function signInAs(user: TestUser) {
  return userClient(user.email, user.password);
}

/** Get the JWT for a signed-in user. */
export async function getUserJwt(user: TestUser): Promise<string> {
  const c = await signInAs(user);
  const { data } = await c.auth.getSession();
  if (!data.session?.access_token) throw new Error("No session token");
  return data.session.access_token;
}
