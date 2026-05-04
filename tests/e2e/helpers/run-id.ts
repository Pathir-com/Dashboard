/**
 * Run-id tagging.
 *
 * Every resource created during a test run is tagged with a stable run-id
 * so the wipe script can find and delete them across Supabase / Twilio /
 * ElevenLabs without orphaning anything.
 *
 * The run-id is per-process by default; export RUN_ID to override (useful
 * when chaining test files that need to share resources, or when debugging
 * a previous run).
 */

import { randomBytes } from "node:crypto";

const TAG_PREFIX = "e2e-pathir";

let cachedRunId: string | null = null;

export function runId(): string {
  if (cachedRunId) return cachedRunId;
  cachedRunId = process.env.RUN_ID || `${TAG_PREFIX}-${Date.now()}-${randomBytes(3).toString("hex")}`;
  return cachedRunId;
}

/** Email address for the i-th test user in this run. */
export function testEmail(i: number = 0): string {
  return `${runId()}-u${i}@pathir-test.invalid`;
}

/** Practice name for the i-th test practice in this run. */
export function testPracticeName(i: number = 0, label: string = "Clinic"): string {
  return `${runId()} ${label} ${i}`;
}

/** Tag prefix used to find resources owned by ANY test run. */
export function tagPrefix(): string {
  return TAG_PREFIX;
}
