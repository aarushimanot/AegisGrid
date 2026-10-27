import { describe, expect, it } from "vitest";
import { outcomeOf } from "../src/lib/core";
import { applyTrust, assessCredibility, checkRateLimit, findDuplicate, newProfile, type CredibilityInput } from "../src/lib/integrity";
import type { Incident } from "../src/lib/types";

const NOW = "2026-10-27T10:00:00.000Z";
const at = (minutesAgo: number) => new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString();
const vit = { lat: 12.9695, lon: 79.1565 };

describe("trust score and standing", () => {
  it("starts at 50 and rises with genuine requests", () => {
    const p = applyTrust(newProfile("u1", NOW), "GENUINE", NOW);
    expect(p.trustScore).toBe(55);
    expect(p.genuineRequests).toBe(1);
    expect(p.standing).toBe("GOOD");
  });

  it("escalates WARNING at 2 false alarms and RESTRICTED at 3", () => {
    let p = newProfile("u1", NOW);
    p = applyTrust(p, "FALSE_ALARM", NOW);
    expect(p.standing).toBe("GOOD");
    p = applyTrust(p, "FALSE_ALARM", NOW);
    expect(p.standing).toBe("WARNING");
    p = applyTrust(p, "FALSE_ALARM", NOW);
    expect(p.standing).toBe("RESTRICTED");
    expect(p.trustScore).toBe(0);
  });

  it("lets the admin reverse a strike, suspend and reinstate", () => {
    let p = applyTrust(applyTrust(newProfile("u1", NOW), "FALSE_ALARM", NOW), "FALSE_ALARM", NOW);
    p = applyTrust(p, "FALSE_ALARM_REVERSED", NOW, "genuine after all");
    expect(p.falseAlarms).toBe(1);
    expect(p.standing).toBe("GOOD");
    p = applyTrust(p, "SUSPEND", NOW);
    expect(p.standing).toBe("SUSPENDED");
    p = applyTrust(p, "GENUINE", NOW);
    expect(p.standing).toBe("SUSPENDED"); // only the admin lifts a suspension
    p = applyTrust(p, "REINSTATE", NOW);
    expect(p.standing).toBe("GOOD");
    expect(p.history.at(-1)?.event).toBe("REINSTATE");
  });
});

describe("rate limit", () => {
  it("allows 3 requests an hour for a good account and fewer as standing drops", () => {
    const p = { ...newProfile("u1", NOW), recentRequests: [at(50), at(20), at(5), at(90)] };
    const r = checkRateLimit(p, NOW);
    expect(r.allowed).toBe(false);
    expect(r.recent).toHaveLength(3);
    expect(r.retryAfterMinutes).toBe(10);
    expect(checkRateLimit({ ...p, recentRequests: [at(20)], standing: "RESTRICTED" }, NOW).allowed).toBe(false);
    expect(checkRateLimit({ ...p, recentRequests: [at(20)] }, NOW).allowed).toBe(true);
  });

  it("blocks suspended accounts entirely", () => {
    expect(checkRateLimit({ ...newProfile("u1", NOW), standing: "SUSPENDED" }, NOW).allowed).toBe(false);
  });
});

describe("duplicate reports", () => {
  const inc = (id: string, minutesAgo: number, loc = vit, extra: Partial<Incident> = {}): Incident => ({
    incidentId: id, status: "ASSESSED", createdAt: at(minutesAgo), updatedAt: NOW, reporter: {}, description: "", location: loc, media: [], assignments: {},
    assessment: { incidentType: "FIRE", severity: 4, confidence: 80, summary: "", estimatedCasualties: 0, hazards: [], requiredAgents: ["FIRE"], recommendations: [], source: "RULES_ONLY" },
    ...extra,
  });
  const fresh = inc("new", 0);

  it("links to the earliest open report of the same type within 300 m and 20 minutes", () => {
    const near = { lat: vit.lat + 0.001, lon: vit.lon }; // ~110 m
    expect(findDuplicate(fresh, "FIRE", [inc("b", 5, near), inc("a", 10, near)])?.incidentId).toBe("a");
  });

  it("ignores far, old, resolved or different-type reports", () => {
    const far = { lat: vit.lat + 0.01, lon: vit.lon }; // ~1.1 km
    expect(findDuplicate(fresh, "FIRE", [
      inc("far", 5, far), inc("old", 45), inc("done", 5, vit, { status: "RESOLVED" }), inc("self", 0, vit, { incidentId: "new" }),
    ])).toBeUndefined();
    expect(findDuplicate(fresh, "ROAD_ACCIDENT", [inc("a", 5)])).toBeUndefined();
  });
});

describe("credibility", () => {
  const base: CredibilityInput = {
    text: "A car hit a bike at the main gate, the rider is bleeding and unconscious",
    imageLabels: [], media: [], incidentType: "ROAD_ACCIDENT", aiConfidence: 85,
    location: vit, locationSource: "gps", createdAt: NOW, recentRequestCount: 0,
  };

  it("rates a consistent, detailed report HIGH", () => {
    expect(assessCredibility(base)).toEqual({ score: 100, level: "HIGH", flags: [] });
  });

  it("flags an old gallery photo taken far away", () => {
    const c = assessCredibility({
      ...base,
      media: [{ key: "k", kind: "image", contentType: "image/jpeg", meta: { source: "gallery", capturedAt: at(60 * 24 * 5), location: { lat: 13.08, lon: 80.27 } } }],
      imageLabels: ["Car", "Vehicle"],
    });
    expect(c.flags.some((f) => f.includes("5 days"))).toBe(true);
    expect(c.flags.some((f) => f.includes("km from the reported location"))).toBe(true);
    expect(c.level).toBe("MEDIUM");
  });

  it("flags a photo that contradicts the description", () => {
    const c = assessCredibility({
      ...base, text: "Huge fire with smoke coming out of the building", incidentType: "FIRE",
      media: [{ key: "k", kind: "image", contentType: "image/jpeg", meta: { source: "camera", capturedAt: at(1) } }],
      imageLabels: ["Car", "Collision", "Vehicle"],
    });
    expect(c.flags[0]).toMatch(/Photo appears to show/);
  });

  it("drops to LOW for a repeat false-alarm account sending a vague report from far away", () => {
    const profile = { ...newProfile("u1", NOW), falseAlarms: 3, standing: "RESTRICTED" as const };
    const c = assessCredibility({
      ...base, text: "help", aiConfidence: 30, locationSource: "manual", deviceLocation: { lat: 13.08, lon: 80.27 }, profile, recentRequestCount: 2,
    });
    expect(c.level).toBe("LOW");
    expect(c.flags).toHaveLength(5);
  });
});

describe("incident outcome", () => {
  const a = (status: string) => ({ status }) as never;
  it("is a false alarm only if no service completed", () => {
    expect(outcomeOf({ assignments: { FIRE: a("FALSE_ALARM") } } as unknown as Incident)).toBe("FALSE_ALARM");
    expect(outcomeOf({ assignments: { FIRE: a("FALSE_ALARM"), AMBULANCE: a("COMPLETED") } } as unknown as Incident)).toBe("SERVED");
  });
});
