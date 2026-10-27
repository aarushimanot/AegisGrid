import { describe, expect, it } from "vitest";
import { classifyType, estimateCasualties, mergeAssessments, normalizeAgents, ruleBasedAssessment } from "../src/lib/rules";

describe("estimateCasualties", () => {
  it("reads digits", () => expect(estimateCasualties("3 people injured near the bridge")).toBe(3));
  it("reads number words", () => expect(estimateCasualties("two passengers are trapped")).toBe(2));
  it("takes the largest count", () => expect(estimateCasualties("2 injured, 12 passengers on the bus")).toBe(12));
  it("assumes one when someone is hurt but no count is given", () => expect(estimateCasualties("a man is bleeding")).toBe(1));
  it("is zero when nobody is mentioned", () => expect(estimateCasualties("smoke coming from a shop")).toBe(0));
});

describe("classifyType", () => {
  it("detects road accidents from text", () => expect(classifyType({ text: "car and bus collision on the highway", imageLabels: [] })).toBe("ROAD_ACCIDENT"));
  it("lets image labels decide when text is vague", () => expect(classifyType({ text: "please help quickly", imageLabels: ["Fire", "Smoke"] })).toBe("FIRE"));
  it("detects medical emergencies", () => expect(classifyType({ text: "my father collapsed with chest pain", imageLabels: [] })).toBe("MEDICAL"));
  it("falls back to OTHER", () => expect(classifyType({ text: "hello", imageLabels: [] })).toBe("OTHER"));
  it("uses the citizen's category when the evidence is inconclusive", () =>
    expect(ruleBasedAssessment({ text: "please come quickly", imageLabels: [], reportedCategory: "FIRE" }).incidentType).toBe("FIRE"));
  it("prefers the evidence over the citizen's category", () =>
    expect(ruleBasedAssessment({ text: "car crashed into a bike", imageLabels: [], reportedCategory: "MEDICAL" }).incidentType).toBe("ROAD_ACCIDENT"));
});

describe("ruleBasedAssessment", () => {
  it("treats trapped casualties in a crash as critical with a full response", () => {
    const a = ruleBasedAssessment({ text: "truck hit a car, 3 people trapped and bleeding heavily", imageLabels: ["Car Crash"] });
    expect(a.incidentType).toBe("ROAD_ACCIDENT");
    expect(a.severity).toBeGreaterThanOrEqual(4);
    expect(a.requiredAgents).toEqual(["AMBULANCE", "HOSPITAL", "POLICE", "TRAFFIC_POLICE"]);
  });
  it("sends fire + police + ambulance to a serious fire", () => {
    const a = ruleBasedAssessment({ text: "fire in a textile shop, spreading fast, children inside", imageLabels: ["Fire"] });
    expect(a.incidentType).toBe("FIRE");
    expect(a.requiredAgents).toEqual(expect.arrayContaining(["FIRE", "AMBULANCE", "HOSPITAL", "POLICE"]));
  });
  it("routes harassment to women & child safety and police", () => {
    const a = ruleBasedAssessment({ text: "a man has been stalking me and following me home from college", imageLabels: [] });
    expect(a.incidentType).toBe("HARASSMENT");
    expect(a.requiredAgents).toEqual(["POLICE", "WOMEN_CHILD_SAFETY"]);
  });
  it("routes a gas leak to the gas & electricity emergency service", () => {
    const a = ruleBasedAssessment({ text: "strong smell of gas, LPG cylinder leaking in the kitchen", imageLabels: [] });
    expect(a.incidentType).toBe("UTILITY");
    expect(a.requiredAgents).toContain("UTILITY_EMERGENCY");
  });
  it("sends disaster response to a flood", () => {
    expect(ruleBasedAssessment({ text: "flooding in our street, water entering houses", imageLabels: [] }).requiredAgents).toContain("DISASTER_RESPONSE");
  });
});

describe("normalizeAgents", () => {
  it("always pairs an ambulance with a hospital", () => expect(normalizeAgents(["AMBULANCE"], 2)).toEqual(["AMBULANCE", "HOSPITAL"]));
  it("adds traffic police to clear the route for a critical patient", () => expect(normalizeAgents(["AMBULANCE"], 4)).toEqual(["AMBULANCE", "HOSPITAL", "TRAFFIC_POLICE"]));
});

describe("mergeAssessments", () => {
  const rules = ruleBasedAssessment({ text: "man unconscious after accident", imageLabels: [] });
  it("never lets the AI lower severity below the rule floor", () => {
    const merged = mergeAssessments(rules, { ...rules, severity: 1, requiredAgents: ["POLICE"] });
    expect(merged.severity).toBe(rules.severity);
    expect(merged.requiredAgents).toEqual(expect.arrayContaining(rules.requiredAgents));
    expect(merged.source).toBe("BEDROCK+RULES");
  });
  it("accepts a higher AI severity and extra agents", () => {
    const merged = mergeAssessments(rules, { ...rules, severity: 5, requiredAgents: ["FIRE"], hazards: ["fuel leak"] });
    expect(merged.severity).toBe(5);
    expect(merged.requiredAgents).toContain("FIRE");
    expect(merged.hazards).toContain("fuel leak");
  });
});
