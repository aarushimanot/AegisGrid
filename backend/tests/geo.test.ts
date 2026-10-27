import { describe, expect, it } from "vitest";
import { distanceToSegmentKm, estimateEtaMinutes, haversineKm } from "../src/lib/geo";

const VIT = { lat: 12.9692, lon: 79.1559 };
const KATPADI_JN = { lat: 12.9716, lon: 79.1376 };
const CHENNAI = { lat: 13.0827, lon: 80.2707 };

describe("haversineKm", () => {
  it("is zero for the same point", () => expect(haversineKm(VIT, VIT)).toBe(0));
  it("matches the known Vellore–Chennai distance (~121 km)", () => expect(haversineKm(VIT, CHENNAI)).toBeCloseTo(121, -1));
  it("is symmetric", () => expect(haversineKm(VIT, KATPADI_JN)).toBeCloseTo(haversineKm(KATPADI_JN, VIT), 10));
});

describe("estimateEtaMinutes", () => {
  it("never returns less than one minute", () => expect(estimateEtaMinutes(0)).toBe(1));
  it("applies the detour factor at 40 km/h", () => expect(estimateEtaMinutes(10)).toBe(21)); // 14 km at 40 km/h
});

describe("distanceToSegmentKm", () => {
  it("is ~0 for a point on the segment", () => {
    const mid = { lat: (VIT.lat + KATPADI_JN.lat) / 2, lon: (VIT.lon + KATPADI_JN.lon) / 2 };
    expect(distanceToSegmentKm(mid, VIT, KATPADI_JN)).toBeLessThan(0.01);
  });
  it("clamps to the nearest endpoint beyond the segment", () => {
    const beyond = { lat: VIT.lat, lon: VIT.lon + 0.05 };
    expect(distanceToSegmentKm(beyond, KATPADI_JN, VIT)).toBeCloseTo(haversineKm(beyond, VIT), 1);
  });
});
