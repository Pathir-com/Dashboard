/**
 * Onboarding + agent provisioning, both verticals.
 *
 * Verifies:
 *   - Practice row stores the chosen industry
 *   - provision-practice creates an ElevenLabs agent
 *   - Agent name uses the right persona (Poppy / Hannah)
 *   - Agent first_message templates the practice name in
 *   - Agent platform_settings allow text-channel overrides
 *   - DB stores elevenlabs_agent_id on the practice row
 */

import { afterAll, describe, expect, it } from "vitest";
import { admin, invokeFunction } from "../helpers/supabase.ts";
import { createTestPractice, createTestUser, getUserJwt, type TestUser, type TestPractice } from "../helpers/factories.ts";
import { deleteAgent, getAgent } from "../helpers/elevenlabs.ts";
import { runId } from "../helpers/run-id.ts";

interface Built { user: TestUser; practice: TestPractice; agentId: string }
const built: Built[] = [];

const VERTICALS = [
  { industry: "dental" as const,         persona: "Poppy",  i: 10 },
  { industry: "hair_transplant" as const, persona: "Hannah", i: 11 },
];

describe(`Onboarding + provisioning [${runId()}]`, () => {
  for (const v of VERTICALS) {
    it(`${v.industry}: stores industry on practice row`, async () => {
      const user = await createTestUser(v.i);
      const practice = await createTestPractice(user, { industry: v.industry, i: v.i });
      built.push({ user, practice, agentId: "" });

      const sb = await admin();
      const { data } = await sb
        .from("practices")
        .select("industry, name")
        .eq("id", practice.id)
        .single();
      expect(data?.industry).toBe(v.industry);
      expect(data?.name).toContain(runId());
    });

    it(`${v.industry}: provision-practice creates ElevenLabs agent`, async () => {
      const entry = built[built.length - 1];
      const jwt = await getUserJwt(entry.user);
      const res = await invokeFunction("provision-practice", { practiceId: entry.practice.id }, jwt);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.agent_id).toBeTruthy();
      expect(res.body.agent_name).toBe(v.persona);
      expect(res.body.industry).toBe(v.industry);
      entry.agentId = res.body.agent_id;
    });

    it(`${v.industry}: agent's first_message contains "${v.persona}" + practice name`, async () => {
      const entry = built[built.length - 1];
      const agent = await getAgent(entry.agentId);
      const firstMsg: string =
        agent?.conversation_config?.agent?.first_message ||
        agent?.first_message ||
        "";
      expect(firstMsg).toContain(v.persona);
      expect(firstMsg).toContain(entry.practice.name);
    });

    it(`${v.industry}: agent allows text-channel overrides`, async () => {
      const entry = built[built.length - 1];
      const agent = await getAgent(entry.agentId);
      const overrides = agent?.platform_settings?.overrides?.conversation_config_override;
      expect(overrides?.agent?.prompt?.prompt).toBe(true);
      expect(overrides?.agent?.first_message).toBe(true);
    });

    it(`${v.industry}: practice row stores elevenlabs_agent_id`, async () => {
      const entry = built[built.length - 1];
      const sb = await admin();
      const { data } = await sb
        .from("practices")
        .select("elevenlabs_agent_id")
        .eq("id", entry.practice.id)
        .single();
      expect(data?.elevenlabs_agent_id).toBe(entry.agentId);
    });
  }
});

afterAll(async () => {
  const sb = await admin();
  for (const b of built) {
    if (b.agentId) {
      try { await deleteAgent(b.agentId); } catch { /* swallow — wipe.ts will retry */ }
    }
    await sb.from("practices").delete().eq("id", b.practice.id);
    await sb.auth.admin.deleteUser(b.user.id);
  }
});
