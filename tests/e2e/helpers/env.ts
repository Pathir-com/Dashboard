/**
 * Test-environment loader.
 *
 * Loads credentials from `.env.test` if present, otherwise bootstraps them
 * from ~/.supabase/access-token via the Supabase Management API. This is
 * deliberately permissive — re-running tests on a fresh checkout shouldn't
 * require manual env-var setup.
 *
 * Required (auto-bootstrapped where possible):
 *   SUPABASE_URL                — derived from project ref
 *   SUPABASE_ANON_KEY           — fetched via Management API
 *   SUPABASE_SERVICE_ROLE_KEY   — fetched via Management API
 *   ELEVENLABS_API_KEY          — must be in .env.test (Mgmt API masks values)
 *   TWILIO_ACCOUNT_SID          — must be in .env.test
 *   TWILIO_AUTH_TOKEN           — must be in .env.test
 *
 * Optional:
 *   TEST_TARGET_PHONE           — UK mobile that real SMS / call tests dial
 *   VAPI_API_KEY                — enables outbound call test
 *   PATHIR_TRIAL_SMS_NUMBER     — defaults to +447418341716
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config as dotenvConfig } from "dotenv";

const PROJECT_REF = "amxcposgqlmgapzoopze";
const RUN_STATE_DIR = join(process.cwd(), "tests/e2e/.run-state");
const ENV_TEST_PATH = join(process.cwd(), ".env.test");

if (existsSync(ENV_TEST_PATH)) {
  dotenvConfig({ path: ENV_TEST_PATH });
}

if (!existsSync(RUN_STATE_DIR)) {
  mkdirSync(RUN_STATE_DIR, { recursive: true });
}

async function fetchSupabaseKeys(): Promise<{ anon: string; serviceRole: string }> {
  const tokenPath = join(homedir(), ".supabase/access-token");
  if (!existsSync(tokenPath)) {
    throw new Error(
      `Missing ~/.supabase/access-token; either create it or set SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY in .env.test`,
    );
  }
  const token = readFileSync(tokenPath, "utf8").trim();
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`Management API returned ${res.status}: ${await res.text()}`);
  }
  const keys = (await res.json()) as Array<{ name: string; api_key: string }>;
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  const serviceRole = keys.find((k) => k.name === "service_role")?.api_key;
  if (!anon || !serviceRole) {
    throw new Error("Could not find anon/service_role keys via Management API");
  }
  return { anon, serviceRole };
}

let cached: TestEnv | null = null;

export interface TestEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ELEVENLABS_API_KEY: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  PATHIR_TRIAL_SMS_NUMBER: string;
  TEXTMAGIC_USERNAME?: string;
  TEXTMAGIC_API_KEY?: string;
  TEST_TARGET_PHONE?: string;
  VAPI_API_KEY?: string;
}

export async function loadEnv(): Promise<TestEnv> {
  if (cached) return cached;

  const supabaseUrl =
    process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;

  let anon = process.env.SUPABASE_ANON_KEY;
  let serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!anon || !serviceRole) {
    const fetched = await fetchSupabaseKeys();
    anon ??= fetched.anon;
    serviceRole ??= fetched.serviceRole;
  }

  const required = (name: string): string => {
    const v = process.env[name];
    if (!v) {
      throw new Error(
        `Missing ${name} — add it to .env.test. ` +
          `For ElevenLabs/Twilio, the Supabase Management API only returns digests, ` +
          `so values must be supplied directly.`,
      );
    }
    return v;
  };

  cached = {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: anon!,
    SUPABASE_SERVICE_ROLE_KEY: serviceRole!,
    ELEVENLABS_API_KEY: required("ELEVENLABS_API_KEY"),
    TWILIO_ACCOUNT_SID: required("TWILIO_ACCOUNT_SID"),
    TWILIO_AUTH_TOKEN: required("TWILIO_AUTH_TOKEN"),
    PATHIR_TRIAL_SMS_NUMBER: process.env.PATHIR_TRIAL_SMS_NUMBER || "+447418341716",
    TEXTMAGIC_USERNAME: process.env.TEXTMAGIC_USERNAME,
    TEXTMAGIC_API_KEY: process.env.TEXTMAGIC_API_KEY,
    TEST_TARGET_PHONE: process.env.TEST_TARGET_PHONE,
    VAPI_API_KEY: process.env.VAPI_API_KEY,
  };

  return cached;
}

export function writeRunState(name: string, data: unknown): void {
  writeFileSync(join(RUN_STATE_DIR, name), JSON.stringify(data, null, 2));
}

export function readRunState<T>(name: string): T | null {
  const path = join(RUN_STATE_DIR, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
