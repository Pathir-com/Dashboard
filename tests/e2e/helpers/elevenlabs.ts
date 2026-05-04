/**
 * ElevenLabs API helper. Used for verifying agent provisioning and cleanup.
 */

import { loadEnv } from "./env.ts";
import { tagPrefix } from "./run-id.ts";

async function elFetch(path: string, init?: RequestInit): Promise<Response> {
  const env = await loadEnv();
  return fetch(`https://api.elevenlabs.io${path}`, {
    ...init,
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

export interface ElevenLabsAgent {
  agent_id: string;
  name: string;
}

export async function getAgent(agentId: string): Promise<any> {
  const res = await elFetch(`/v1/convai/agents/${agentId}`);
  if (!res.ok) throw new Error(`getAgent ${agentId}: ${res.status}`);
  return res.json();
}

export async function listAgents(): Promise<ElevenLabsAgent[]> {
  /* ElevenLabs caps page_size at 30; paginate via has_more. */
  const out: ElevenLabsAgent[] = [];
  let cursor: string | null = null;
  while (true) {
    const url = `/v1/convai/agents?page_size=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await elFetch(url);
    if (!res.ok) throw new Error(`listAgents: ${res.status}`);
    const data = await res.json() as { agents?: any[]; next_cursor?: string; has_more?: boolean };
    for (const a of data.agents || []) {
      out.push({ agent_id: a.agent_id, name: a.name });
    }
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return out;
}

export async function deleteAgent(agentId: string): Promise<void> {
  const res = await elFetch(`/v1/convai/agents/${agentId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteAgent ${agentId}: ${res.status} ${await res.text()}`);
  }
}

/** Find every agent whose name contains the test tag prefix. */
export async function listTestAgents(): Promise<ElevenLabsAgent[]> {
  const all = await listAgents();
  return all.filter((a) => a.name.includes(tagPrefix()));
}
