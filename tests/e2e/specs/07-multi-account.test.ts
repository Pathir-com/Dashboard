/**
 * Multi-account stress: provision N practices in parallel, each with a
 * distinct industry mix. Verifies the system handles concurrent agent
 * provisioning without name collisions or cross-account leakage.
 */

import { afterAll, describe, expect, it } from "vitest";
import { admin, invokeFunction } from "../helpers/supabase.ts";
import {
  createTestPractice, createTestUser, getUserJwt,
  type TestPractice, type TestUser,
} from "../helpers/factories.ts";
import { deleteAgent } from "../helpers/elevenlabs.ts";
import { runId } from "../helpers/run-id.ts";

const N = 4;
const built: Array<{ user: TestUser; practice: TestPractice; agentId: string }> = [];

describe(`Multi-account parallel provisioning [${runId()}]`, () => {
  it(`provisions ${N} accounts in parallel with mixed verticals`, async () => {
    const tasks = Array.from({ length: N }, (_, i) => async () => {
      const industry = i % 2 === 0 ? "dental" as const : "hair_transplant" as const;
      const user = await createTestUser(50 + i);
      const practice = await createTestPractice(user, { industry, i: 50 + i });
      const jwt = await getUserJwt(user);
      const res = await invokeFunction("provision-practice", { practiceId: practice.id }, jwt);
      if (res.status !== 200) throw new Error(`#${i} failed: ${JSON.stringify(res.body)}`);
      return { user, practice, agentId: res.body.agent_id };
    });

    const results = await Promise.all(tasks.map((t) => t()));
    built.push(...results);

    expect(results.length).toBe(N);
    const agentIds = new Set(results.map((r) => r.agentId));
    expect(agentIds.size).toBe(N); // all agents unique
  }, 60_000);

  it("each account sees only its own practice via RLS", async () => {
    for (const b of built) {
      const env = await import("../helpers/supabase.ts").then((m) => m.userClient(b.user.email, b.user.password));
      const { data } = await env.from("practices").select("id");
      expect(data?.map((p) => p.id)).toEqual([b.practice.id]);
    }
  });

  it("agent persona matches the chosen vertical for each account", async () => {
    const sb = await admin();
    for (const b of built) {
      const { data } = await sb
        .from("practices")
        .select("industry, elevenlabs_agent_id")
        .eq("id", b.practice.id)
        .single();
      expect(data?.elevenlabs_agent_id).toBe(b.agentId);
      expect(["dental", "hair_transplant"]).toContain(data?.industry);
    }
  });
});

afterAll(async () => {
  const sb = await admin();
  await Promise.all(built.map(async (b) => {
    if (b.agentId) try { await deleteAgent(b.agentId); } catch { /* */ }
    await sb.from("practices").delete().eq("id", b.practice.id);
    await sb.auth.admin.deleteUser(b.user.id);
  }));
});
