/**
 * Patient brain CLI. Reads a JSON chat history from stdin (array of
 * {role:"clinic"|"patient", text}), opens an ElevenLabs ConvAI WebSocket
 * against a throwaway patient agent, gets one new patient reply, prints it.
 *
 *   echo '[{"role":"clinic","text":"Hi, which clinic?"}]' | \
 *     PATIENT_PERSONA="..." npx tsx tests/live/patient-brain.ts
 *
 * Used by the sms-e2e-*.sh scripts to drive multi-turn conversations
 * naturally through ElevenLabs' LLM (Claude/GPT under the hood), without
 * needing a separate Anthropic/OpenAI key.
 *
 * Caches the agent_id in /tmp/.patient-brain-agent.id so successive turns
 * within a script reuse the same agent. The script's `cleanup` step (or a
 * separate --cleanup invocation here) should delete it.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { loadEnv } from "../e2e/helpers/env.ts";

const CACHE = "/tmp/.patient-brain-agent.id";
const PERSONA = process.env.PATIENT_PERSONA || `You are Sam Rivers, a patient texting a dental clinic to book an appointment. Goal: get a routine check-up booked for next Friday morning. If asked your name, say Sam Rivers; DOB 3rd March 1990. When a specific slot is offered, accept it. Once the clinic confirms it is booked, reply "Thank you, goodbye!" and stop. One short SMS sentence per turn, no quotes, no labels.`;

async function ensureAgent(env: { ELEVENLABS_API_KEY: string }): Promise<string> {
  if (existsSync(CACHE)) {
    const id = readFileSync(CACHE, "utf8").trim();
    if (id) return id;
  }
  const r = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      name: `SMS Patient Brain ${Date.now()}`,
      conversation_config: {
        agent: { prompt: { prompt: PERSONA, llm: "gpt-4o" }, first_message: "", language: "en" },
      },
      /* WebSocket clients must be allowed to override prompt + first_message,
         otherwise we hit "Override for field 'prompt' is not allowed by config"
         and the WS closes. Mirrors what provision.ts sets on practice agents. */
      platform_settings: {
        overrides: {
          conversation_config_override: {
            agent: {
              prompt: { prompt: true, tools: true },
              first_message: true,
              language: true,
            },
          },
        },
      },
    }),
  });
  if (!r.ok) throw new Error(`agent create ${r.status}: ${await r.text()}`);
  const id = (await r.json() as { agent_id: string }).agent_id;
  writeFileSync(CACHE, id);
  return id;
}

async function cleanup() {
  if (!existsSync(CACHE)) return;
  const id = readFileSync(CACHE, "utf8").trim();
  const env = await loadEnv();
  await fetch(`https://api.elevenlabs.io/v1/convai/agents/${id}`, { method: "DELETE", headers: { "xi-api-key": env.ELEVENLABS_API_KEY } });
  unlinkSync(CACHE);
  console.error(`[patient-brain] cleaned up agent ${id}`);
}

async function turn(history: Array<{ role: "clinic" | "patient"; text: string }>): Promise<string> {
  const env = await loadEnv();
  const agentId = await ensureAgent(env);
  const signed = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`, { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } });
  if (!signed.ok) throw new Error(`signed-url ${signed.status}`);
  const { signed_url } = await signed.json() as { signed_url: string };
  const WS = (await import("ws")).default as unknown as typeof import("ws").WebSocket;

  const last = [...history].reverse().find((t) => t.role === "clinic")?.text || "";
  const prior = history.slice(0, -1).map((t) => `${t.role === "patient" ? "you" : "clinic"}: ${t.text}`).join("\n");
  const promptWithCtx = `${PERSONA}\n\nConversation so far:\n${prior || "(none)"}\n\nThe clinic just said the user_message below — reply as the patient with ONE short SMS sentence.`;

  return await new Promise<string>((resolve, reject) => {
    let done = false;
    const finish = (v: string | Error) => { if (done) return; done = true; clearTimeout(t); try { (ws as any).close(); } catch { /* */ } v instanceof Error ? reject(v) : resolve(v); };
    const t = setTimeout(() => finish(new Error("timeout waiting for agent_response")), 45_000);
    const ws = new WS(signed_url);
    let seen = 0;
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "conversation_initiation_client_data",
        conversation_config_override: { agent: { prompt: { prompt: promptWithCtx, tools: [] }, first_message: "", language: "en" } },
      }));
    });
    ws.on("message", (raw: any) => {
      let d: any; try { d = JSON.parse(raw.toString()); } catch { console.error("[patient-brain] non-json:", raw.toString().slice(0, 80)); return; }
      if (process.env.BRAIN_DEBUG) console.error("[patient-brain] frame:", d.type, JSON.stringify(d).slice(0, 200));
      if (d.type === "conversation_initiation_metadata") {
        ws.send(JSON.stringify({ type: "user_message", text: last }));
      } else if (d.type === "agent_response") {
        seen++;
        if (seen === 1) {
          const txt = d.agent_response_event?.agent_response;
          if (typeof txt === "string" && txt.trim()) finish(txt.trim());
        }
      } else if (d.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", event_id: d.ping_event?.event_id }));
      }
    });
    ws.on("error", (e: Error) => finish(e));
    ws.on("close", (code: number, reason: any) => finish(new Error(`ws closed code=${code} reason=${reason?.toString?.() || ""}`)));
  });
}

async function main() {
  if (process.argv.includes("--cleanup")) { await cleanup(); return; }
  const stdin = readFileSync(0, "utf8");
  const history = JSON.parse(stdin);
  const reply = await turn(history);
  process.stdout.write(reply);
}

main().catch((e) => { console.error(`[patient-brain] ${e.message}`); process.exit(1); });
