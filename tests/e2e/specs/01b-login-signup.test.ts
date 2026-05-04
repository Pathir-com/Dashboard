/**
 * Login + signup user-flow tests.
 *
 * 01-signup.test.ts uses the admin API to create users (fast path); this
 * file exercises the same surface the Login.jsx form hits — `auth.signUp`
 * + `auth.signInWithPassword` against the anon client — plus the
 * regression cases that have bitten before:
 *   - Duplicate email signup
 *   - Wrong-password sign-in
 *   - Sign-out invalidates the session
 *   - Refresh token returns a new access token
 *   - signUp with `data.fullName` survives into user_metadata (matches the
 *     actual Login.jsx call shape)
 */

import { afterAll, describe, expect, it } from "vitest";
import { admin, anon } from "../helpers/supabase.ts";
import { runId, testEmail } from "../helpers/run-id.ts";

const PASSWORD = "TestPathir-2026!";
const createdUserIds: string[] = [];

describe(`Login + signup form-paths [${runId()}]`, () => {
  it("auth.signUp succeeds and stores fullName in user_metadata", async () => {
    const c = await anon();
    const email = testEmail(60);
    const { data, error } = await c.auth.signUp({
      email,
      password: PASSWORD,
      options: { data: { fullName: "Dr Test User" } },
    });
    expect(error).toBeNull();
    expect(data.user?.id).toBeTruthy();
    expect(data.user?.user_metadata?.fullName).toBe("Dr Test User");
    if (data.user) createdUserIds.push(data.user.id);
  });

  it("auth.signUp with same email returns helpful error", async () => {
    const c = await anon();
    const email = testEmail(60);
    /* Supabase returns a user object with empty identities[] on duplicate
       signup attempts (when "Confirm email" is on) — that's the signal a
       real frontend has to detect to avoid showing "Check your email"
       falsely to a returning user. We assert the shape matches. */
    const { data, error } = await c.auth.signUp({ email, password: PASSWORD });
    if (error) {
      expect(error.message.toLowerCase()).toMatch(/already|registered|exists/);
    } else {
      expect(data.user?.identities?.length || 0).toBe(0);
    }
  });

  it("admin auto-confirms user so signInWithPassword succeeds", async () => {
    /* Without admin auto-confirm, signUp returns a user but no session,
       and signInWithPassword 400s with "Email not confirmed". Confirming
       via admin sidesteps the email loop in test. */
    const sb = await admin();
    const email = testEmail(61);
    const created = await sb.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (created.data.user) createdUserIds.push(created.data.user.id);

    const c = await anon();
    const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
    expect(error).toBeNull();
    expect(data.session?.access_token).toBeTruthy();
  });

  it("wrong password is rejected with no session", async () => {
    const sb = await admin();
    const email = testEmail(62);
    const created = await sb.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (created.data.user) createdUserIds.push(created.data.user.id);

    const c = await anon();
    const { data, error } = await c.auth.signInWithPassword({
      email,
      password: "WrongPassword-2026",
    });
    expect(error).toBeTruthy();
    expect(data.session).toBeNull();
  });

  it("sign-out invalidates the session", async () => {
    const sb = await admin();
    const email = testEmail(63);
    const created = await sb.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (created.data.user) createdUserIds.push(created.data.user.id);

    const c = await anon();
    const signIn = await c.auth.signInWithPassword({ email, password: PASSWORD });
    expect(signIn.data.session).toBeTruthy();
    const accessToken = signIn.data.session!.access_token;

    await c.auth.signOut();
    /* After sign-out the local session is cleared. We verify the token
       can no longer fetch the user by hitting the /user endpoint with
       the ex-session JWT directly. */
    const env = await import("../helpers/env.ts").then((m) => m.loadEnv());
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    /* Supabase returns 401 once signOut has revoked the token. */
    expect([401, 403]).toContain(res.status);
  });

  it("session refresh token issues a new access token", async () => {
    const sb = await admin();
    const email = testEmail(64);
    const created = await sb.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true,
    });
    if (created.data.user) createdUserIds.push(created.data.user.id);

    const c = await anon();
    const first = await c.auth.signInWithPassword({ email, password: PASSWORD });
    expect(first.data.session?.refresh_token).toBeTruthy();
    const original = first.data.session!.access_token;
    const refresh = first.data.session!.refresh_token;

    const { data, error } = await c.auth.refreshSession({ refresh_token: refresh });
    expect(error).toBeNull();
    expect(data.session?.access_token).toBeTruthy();
    expect(data.session?.access_token).not.toBe(original);
  });
});

afterAll(async () => {
  const sb = await admin();
  for (const id of createdUserIds) {
    try { await sb.auth.admin.deleteUser(id); } catch { /* */ }
  }
});
