/**
 * Guard against silent Supabase project pausing. Free/Pro projects can move
 * from ACTIVE_HEALTHY to INACTIVE (auto-pause on inactivity, billing check,
 * etc.). When they do, DNS stops resolving, Auth is dead, and the entire
 * app breaks — but our CI wouldn't know until a downstream test failed with
 * a cryptic "Could not find anon/service_role keys" error.
 *
 * This test hits the Supabase Management API's project-detail endpoint and
 * asserts the project's `status` is one of the healthy states. First test
 * to fail if the project ever pauses again, so the alert is unambiguous.
 *
 * The Supabase access token lives at ~/.supabase/access-token; skips if
 * missing (some CI environments won't have it).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PROJECT_REF = "amxcposgqlmgapzoopze";
const HEALTHY = new Set(["ACTIVE_HEALTHY"]);
// COMING_UP and RESTORING are transient during a restore we triggered.
const TRANSIENT_OK = new Set(["COMING_UP", "RESTORING", "MIGRATING", "UPGRADING", "PAUSING"]);

function readAccessToken(): string | null {
  const path = join(homedir(), ".supabase", "access-token");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim();
}

describe("Supabase project health", () => {
  it("project status is ACTIVE_HEALTHY (not paused, not restoring)", async () => {
    const token = readAccessToken();
    if (!token) {
      console.log("[project-health] skipped — no ~/.supabase/access-token");
      expect(true).toBe(true);
      return;
    }
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.ok, `management API responded ${r.status}`).toBe(true);
    const proj = await r.json() as { status: string; name: string };
    const status = proj.status;
    if (TRANSIENT_OK.has(status)) {
      console.log(`[project-health] transient state: ${status} — retry after restore completes`);
    }
    expect(HEALTHY.has(status), `project ${proj.name} is "${status}" (expected ACTIVE_HEALTHY — project may have auto-paused; POST /v1/projects/${PROJECT_REF}/restore to recover)`).toBe(true);
  }, 30_000);
});
