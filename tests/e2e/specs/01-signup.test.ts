/**
 * Signup + multi-account isolation tests.
 *
 * Verifies:
 *   - We can create N test users back-to-back without collision
 *   - Each user can sign in afterwards
 *   - Each user can read getMyPractice() and gets null until they create one
 *   - RLS isolates users — user A cannot read user B's practice row
 */

import { afterAll, describe, expect, it } from "vitest";
import { admin } from "../helpers/supabase.ts";
import { createTestPractice, createTestUser, signInAs, type TestUser } from "../helpers/factories.ts";
import { runId } from "../helpers/run-id.ts";

const ACCOUNT_COUNT = 3;
const created: TestUser[] = [];

describe(`Signup + multi-account [${runId()}]`, () => {
  it("creates N independent users", async () => {
    for (let i = 0; i < ACCOUNT_COUNT; i++) {
      const u = await createTestUser(i);
      created.push(u);
      expect(u.id).toBeTruthy();
      expect(u.email).toContain(runId());
    }
    expect(created.length).toBe(ACCOUNT_COUNT);
    const ids = new Set(created.map((u) => u.id));
    expect(ids.size).toBe(ACCOUNT_COUNT);
  });

  it("each user can sign in", async () => {
    for (const u of created) {
      const c = await signInAs(u);
      const { data, error } = await c.auth.getUser();
      expect(error).toBeNull();
      expect(data.user?.id).toBe(u.id);
    }
  });

  it("each user has no practice until they create one", async () => {
    for (const u of created) {
      const c = await signInAs(u);
      const { data } = await c
        .from("practices")
        .select("id")
        .eq("owner_id", u.id)
        .maybeSingle();
      expect(data).toBeNull();
    }
  });

  it("RLS isolates users — A cannot read B's practice", async () => {
    const [a, b] = created;
    await createTestPractice(b, { industry: "dental", i: 0 });
    const aClient = await signInAs(a);
    const { data } = await aClient
      .from("practices")
      .select("id")
      .eq("owner_id", b.id);
    expect(data || []).toEqual([]);
  });
});

afterAll(async () => {
  /* Wipe-by-test cleanup. The run-id tag in email + practice name lets the
     wipe.ts script find these too if a test crashes mid-way. */
  const sb = await admin();
  for (const u of created) {
    await sb.from("practices").delete().eq("owner_id", u.id);
    await sb.auth.admin.deleteUser(u.id);
  }
});
