import { describe, expect, it } from "vitest";
import { flatten } from "../src/handlers/platform/analytics-export";
import { toCitizenView } from "../src/lib/citizen-view";
import { renderEvent } from "../src/lib/messages";
import type { Incident } from "../src/lib/types";

const incident: Incident = {
  incidentId: "11111111-2222-3333-4444-555555555555",
  status: "RESOLVED",
  createdAt: "2026-10-17T10:00:00.000Z",
  updatedAt: "2026-10-17T10:40:00.000Z",
  resolvedAt: "2026-10-17T10:40:00.000Z",
  firstArrivalAt: "2026-10-17T10:08:00.000Z",
  reporter: {},
  description: "accident",
  location: { lat: 12.97, lon: 79.15 },
  media: [],
  assessment: {
    incidentType: "ROAD_ACCIDENT", severity: 4, confidence: 85, summary: "", estimatedCasualties: 2, hazards: [],
    requiredAgents: ["AMBULANCE", "HOSPITAL"], recommendations: [], source: "BEDROCK+RULES",
  },
  assignments: {
    AMBULANCE: {
      serviceType: "AMBULANCE", status: "COMPLETED", stationId: "s1", stationName: "Katpadi 108", acceptedAt: "2026-10-17T10:01:00.000Z",
      arrivedAt: "2026-10-17T10:08:00.000Z", responseMinutes: 8, tried: [{ stationId: "s0", stationName: "VIT 108", outcome: "TRANSFERRED", at: "" }], updatedAt: "",
    },
    HOSPITAL: { serviceType: "HOSPITAL", status: "ACCEPTED", stationId: "h1", stationName: "CMC", acceptedAt: "2026-10-17T10:02:00.000Z", arrivalOtp: "123456", tried: [], updatedAt: "" },
  },
};

describe("analytics flatten", () => {
  it("derives response KPIs", () => {
    const row = flatten(incident);
    expect(row.time_to_accept_min).toBe(1);
    expect(row.response_time_min).toBe(8);
    expect(row.time_to_resolve_min).toBe(40);
    expect(row.transfers).toBe(1);
    expect(row.ambulance_response_min).toBe(8);
    expect(row.required_services).toBe("AMBULANCE,HOSPITAL");
  });
});

describe("citizen view", () => {
  it("shows response time and the arrival code only while the responder is on the way", () => {
    const v = toCitizenView(incident);
    expect(v.responseMinutes).toBe(8);
    expect(v.resolutionMinutes).toBe(40);
    const hospital = v.services.find((s) => s.service === "HOSPITAL")!;
    expect(hospital.arrivalCode).toBe("123456");
    expect(v.services.find((s) => s.service === "AMBULANCE")!.arrivalCode).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain("assessment_source");
  });
});

describe("renderEvent", () => {
  it("routes a new request to the station's service", () => {
    const r = renderEvent("Offer.Created", { incidentId: incident.incidentId, serviceType: "FIRE", stationName: "Katpadi Fire Station", distanceKm: 2.1 });
    expect(r?.departments).toEqual(["FIRE"]);
    expect(r?.subject.length).toBeLessThanOrEqual(100);
  });
  it("escalates when no station is available", () => {
    expect(renderEvent("Service.Unavailable", { serviceType: "AMBULANCE", tried: 2 })?.departments).toContain("CONTROL_ROOM");
  });
  it("ignores unknown events", () => expect(renderEvent("Something.Else", {})).toBeUndefined());
});
