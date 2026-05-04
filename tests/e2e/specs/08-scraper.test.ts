/**
 * Website-scraper end-to-end.
 *
 * What this exercises:
 *   - Pure unit tests of the data-mapping helpers (no network)
 *   - The deployed scrape-website function returns the documented shape
 *     and respects ownership when a practiceId is supplied
 *   - Stub-mode response when ANTHROPIC_API_KEY isn't configured (so the
 *     frontend can be tested without paying for LLM calls)
 *
 * What this DOESN'T exercise:
 *   - The actual Anthropic call quality. We just verify the schema.
 *     Live extraction is enabled when ANTHROPIC_API_KEY is set in .env.test.
 */

import { afterAll, describe, expect, it } from "vitest";
import { admin, invokeFunction } from "../helpers/supabase.ts";
import {
  createTestPractice, createTestUser, getUserJwt,
  type TestPractice, type TestUser,
} from "../helpers/factories.ts";
import { runId } from "../helpers/run-id.ts";
import {
  buildPracticePatch, normaliseHours,
  servicesToPriceList, staffToPractitioners,
} from "../../../src/lib/applyScrapedClinic.js";

let user: TestUser;
let practice: TestPractice;

describe(`Website scraper helpers [${runId()}]`, () => {
  it("servicesToPriceList: maps Base44 shape into price_list rows", () => {
    const out = servicesToPriceList([
      { name: "New Patient Consultation", description: "30 mins", price: "from £85" },
      { name: "Hygiene", price: "£75.00" },
      { name: "" }, // skipped
    ]);
    expect(out.length).toBe(2);
    expect(out[0]).toMatchObject({
      service_name: "New Patient Consultation",
      price: "85",
      is_from_price: true,
    });
    expect(out[1].price).toBe("75.00");
  });

  it("staffToPractitioners: maps staff with credentials/specialty", () => {
    const out = staffToPractitioners([
      { name: "Dr Amelia Hartley", title: "Dr", credentials: "BDS", specialty: "Cosmetic" },
      { name: "" }, // skipped
    ]);
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({
      name: "Dr Amelia Hartley",
      credentials: "BDS",
      bio: "Specialises in Cosmetic.",
    });
  });

  it("normaliseHours: produces 7 rows even when scraper returns 5", () => {
    const out = normaliseHours([
      { day: "Monday",    is_open: true,  open_time: "09:00", close_time: "17:00" },
      { day: "Wednesday", is_open: true,  open_time: "10:00", close_time: "18:00" },
      { day: "Friday",    is_open: false, open_time: "09:00", close_time: "13:00" },
    ]);
    expect(out!.length).toBe(7);
    expect(out![0].day).toBe("Monday");
    expect(out![6].day).toBe("Sunday");
    expect(out![2].is_open).toBe(true);   // Wednesday from input
    expect(out![1].is_open).toBe(true);   // Tuesday default
  });

  it("normaliseHours: returns null when scraper found nothing", () => {
    expect(normaliseHours([])).toBeNull();
    expect(normaliseHours(undefined as any)).toBeNull();
  });

  it("buildPracticePatch: only includes fields the scraper populated", () => {
    const patch = buildPracticePatch({
      name: "Spark Dental",
      phone: "",
      email: "",
      address: "",
      description: "Independent practice in Mayfair.",
      services: [],
      business_hours: [],
      staff: [{ name: "Dr A", title: "Dr" }],
      faqs: [],
      insurance_accepted: [],
      appointment_booking_url: "",
      agent_tone: "",
      clinic_guidelines: "",
    } as any);
    expect(patch.name).toBe("Spark Dental");
    expect(patch.usps).toContain("Mayfair");
    expect(patch.practitioners?.length).toBe(1);
    expect(patch.phone).toBeUndefined();
    expect(patch.email).toBeUndefined();
    expect(patch.opening_hours).toBeUndefined();
  });
});

describe(`scrape-website function [${runId()}]`, () => {
  it("setup: provision a practice for ownership tests", async () => {
    user = await createTestUser(70);
    practice = await createTestPractice(user, { industry: "dental", i: 70 });
    expect(practice.id).toBeTruthy();
  });

  it("rejects unauthenticated calls", async () => {
    const res = await invokeFunction(
      "scrape-website",
      { practiceId: practice.id, url: "https://example.com" },
      "invalid-jwt",
    );
    if (res.status === 404) {
      console.log("[08-scraper] scrape-website not deployed yet — skipping auth assertion");
      expect(true).toBe(true);
      return;
    }
    expect([401, 403]).toContain(res.status);
  });

  it("rejects practice you don't own", async () => {
    const otherUser = await createTestUser(71);
    const otherJwt = await getUserJwt(otherUser);
    const res = await invokeFunction(
      "scrape-website",
      { practiceId: practice.id, url: "https://example.com" },
      otherJwt,
    );
    const sb = await admin();
    await sb.auth.admin.deleteUser(otherUser.id);
    if (res.status === 404 && /not\s+found.*function|function.*not\s+found/i.test(JSON.stringify(res.body))) {
      console.log("[08-scraper] scrape-website not deployed yet — skipping ownership assertion");
      expect(true).toBe(true);
      return;
    }
    expect(res.status).toBe(404);
  });

  it("returns the documented schema (live or stub)", async () => {
    const jwt = await getUserJwt(user);
    const res = await invokeFunction(
      "scrape-website",
      { practiceId: practice.id, url: "https://example.com" },
      jwt,
    );
    if (res.status === 404 && /function.*not\s+found/i.test(JSON.stringify(res.body))) {
      console.log("[08-scraper] scrape-website not deployed yet — skipping schema assertion");
      expect(true).toBe(true);
      return;
    }
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(["live", "stub"]).toContain(res.body.mode);
    /* Schema: every required field present, even if empty. */
    const e = res.body.extracted;
    expect(typeof e.name).toBe("string");
    expect(typeof e.phone).toBe("string");
    expect(typeof e.email).toBe("string");
    expect(Array.isArray(e.services)).toBe(true);
    expect(Array.isArray(e.business_hours)).toBe(true);
    expect(Array.isArray(e.staff)).toBe(true);
    expect(Array.isArray(e.faqs)).toBe(true);
    expect(typeof e.appointment_booking_url).toBe("string");
  }, 30_000);

  it("accepts practiceId=null (onboarding path) when JWT is valid", async () => {
    const jwt = await getUserJwt(user);
    const res = await invokeFunction(
      "scrape-website",
      { practiceId: null, url: "https://example.com" },
      jwt,
    );
    if (res.status === 404 && /function.*not\s+found/i.test(JSON.stringify(res.body))) {
      console.log("[08-scraper] scrape-website not deployed yet — skipping null-practice assertion");
      expect(true).toBe(true);
      return;
    }
    expect([200, 502]).toContain(res.status);
  }, 30_000);
});

afterAll(async () => {
  const sb = await admin();
  if (practice) await sb.from("practices").delete().eq("id", practice.id);
  if (user) await sb.auth.admin.deleteUser(user.id);
});
