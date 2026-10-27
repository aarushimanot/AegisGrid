import { describe, expect, it } from "vitest";
import { isValidRegistration } from "../src/lib/catalog";
import { isIncidentFinished, newOtp, offerFor, offeredAssignment, rankStations, triedStationIds, unavailableAssignment } from "../src/lib/core";
import type { Incident, Station } from "../src/lib/types";

const station = (id: string, lat: number, lon: number, extra: Partial<Station> = {}): Station => ({
  stationId: id, ownerUserId: id, ownerEmail: "", serviceType: "FIRE", name: id, registrationNumber: "", issuingAuthority: "",
  contactPerson: { name: "", designation: "" }, phone: "+910000000000", officialEmail: "", address: "", location: { lat, lon },
  unitsTotal: 3, unitsAvailable: 2, coverageKm: 25, onDuty: true, status: "APPROVED",
  verification: { phoneVerified: true, documents: [], declarationAccepted: true },
  stats: { offered: 0, accepted: 0, transferred: 0, completed: 0, totalResponseMinutes: 0 }, createdAt: "", updatedAt: "", ...extra,
});

const citizen = { lat: 12.9695, lon: 79.1565 }; // VIT main gate
const vellore = station("vellore-fire", 12.92, 79.13);
const katpadi = station("katpadi-fire", 12.98, 79.14);

describe("nearest station selection", () => {
  it("offers the request to the nearest approved station first", () => {
    expect(rankStations([vellore, katpadi], "FIRE", citizen).map((r) => r.station.stationId)).toEqual(["katpadi-fire", "vellore-fire"]);
  });
  it("skips stations that are off duty, fully busy, unapproved, out of range or of another service", () => {
    const list = [
      station("off", 12.97, 79.156, { onDuty: false }),
      station("busy", 12.97, 79.156, { unitsAvailable: 0 }),
      station("pending", 12.97, 79.156, { status: "PENDING_REVIEW" }),
      station("far", 13.08, 80.27), // Chennai, 120 km
      station("police", 12.97, 79.156, { serviceType: "POLICE" }),
      vellore,
    ];
    expect(rankStations(list, "FIRE", citizen).map((r) => r.station.stationId)).toEqual(["vellore-fire"]);
  });
  it("moves on to the next nearest station after a transfer", () => {
    const incident = { incidentId: "i", createdAt: "", description: "", location: citizen, reporter: {}, assignments: {} } as unknown as Incident;
    const first = rankStations([vellore, katpadi], "FIRE", citizen)[0]!;
    const a = offeredAssignment(undefined, "FIRE", offerFor(incident, "FIRE", first, "o1", new Date().toISOString()), first, "");
    const after = { ...a, tried: [{ stationId: a.stationId!, stationName: a.stationName!, outcome: "TRANSFERRED" as const, at: "" }] };
    expect(rankStations([vellore, katpadi], "FIRE", citizen, triedStationIds(after))[0]!.station.stationId).toBe("vellore-fire");
    expect(rankStations([vellore, katpadi], "FIRE", citizen, ["katpadi-fire", "vellore-fire"])).toEqual([]);
  });
  it("gives the station 90 seconds to accept", () => {
    const incident = { incidentId: "i", createdAt: "", description: "x", location: citizen, reporter: {}, assignments: {} } as unknown as Incident;
    const now = "2026-10-27T10:00:00.000Z";
    expect(offerFor(incident, "FIRE", rankStations([katpadi], "FIRE", citizen)[0]!, "o", now).expiresAt).toBe("2026-10-27T10:01:30.000Z");
  });
});

describe("one-time codes", () => {
  it("are 6 digits and different every time", () => {
    const codes = new Set(Array.from({ length: 50 }, newOtp));
    expect([...codes].every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(codes.size).toBeGreaterThan(45);
  });
});

describe("incident completion", () => {
  const base = { assignments: {} } as Incident;
  it("finishes only when every service is completed or unavailable, with at least one completed", () => {
    expect(isIncidentFinished({ ...base, assignments: { FIRE: { serviceType: "FIRE", status: "COMPLETED", tried: [], updatedAt: "" } } })).toBe(true);
    expect(isIncidentFinished({ ...base, assignments: { FIRE: { serviceType: "FIRE", status: "COMPLETED", tried: [], updatedAt: "" }, AMBULANCE: { serviceType: "AMBULANCE", status: "ARRIVED", tried: [], updatedAt: "" } } })).toBe(false);
    expect(isIncidentFinished({ ...base, assignments: { FIRE: unavailableAssignment(undefined, "FIRE", "") } })).toBe(false);
  });
});

describe("registration numbers", () => {
  it("validates the official format per service", () => {
    expect(isValidRegistration("FIRE", "TNFRS-VLR-001")).toBe(true);
    expect(isValidRegistration("FIRE", "fire station 1")).toBe(false);
    expect(isValidRegistration("HOSPITAL", "CEA-TN-VLR-2024-0567")).toBe(true);
  });
});
