// Deterministic, explainable triage rules.
//
// These run on every incident, alongside Bedrock. They give a safety floor
// (the AI can raise the severity but never lower it below what the rules
// detect) and a full fallback if Bedrock is unavailable.

import type { AgentName, Assessment, IncidentType, Severity } from "./types";

export interface TriageSignals {
  text: string; // English, already translated
  imageLabels: string[];
  reportedCategory?: IncidentType; // what the citizen selected, used when the evidence is inconclusive
}

const TYPE_KEYWORDS: Record<Exclude<IncidentType, "OTHER">, { words: RegExp; labels: string[] }> = {
  ROAD_ACCIDENT: {
    words: /\b(accident|crash|collision|collided|hit by|run over|overturned|pile[- ]?up|truck|bike|car|bus|lorry|highway)\b/,
    labels: ["Car Crash", "Accident", "Wreck", "Traffic Accident", "Vehicle", "Car", "Motorcycle"],
  },
  FIRE: {
    words: /\b(fire|burning|flames?|smoke|blaze|explosion|exploded|burnt|short circuit)\b/,
    labels: ["Fire", "Flame", "Smoke", "Bonfire", "Explosion"],
  },
  MEDICAL: {
    words: /\b(heart attack|cardiac|chest pain|unconscious|collapsed|stroke|seizure|not breathing|breathing difficulty|pregnant|labou?r|diabetic|overdose|faint(ed)?)\b/,
    labels: ["Patient", "Hospital", "Injury"],
  },
  NATURAL_DISASTER: {
    words: /\b(flood(ing)?|earthquake|landslide|cyclone|tsunami|storm|building collapse|collapsed building|tree fell)\b/,
    labels: ["Flood", "Rubble", "Disaster", "Storm", "Tornado"],
  },
  CRIME: {
    words: /\b(robbery|theft|stabbed|stabbing|shot|gun|knife|assault|attack(ed)?|fight|kidnap(ped)?|murder|riot)\b/,
    labels: ["Weapon", "Gun", "Knife", "Riot"],
  },
  HARASSMENT: {
    words: /\b(harass(ed|ing|ment)?|stalk(ed|ing|er)?|molest(ed)?|eve[- ]teas(ing)?|domestic violence|beaten by (my )?husband|child abuse|abused|missing (child|girl|boy)|trafficking|groped|following me)\b/,
    labels: [],
  },
  HAZMAT: {
    words: /\b(chemical|toxic|ammonia|chlorine|acid|radiation|spill|fumes)\b/,
    labels: ["Gas Mask", "Barrel", "Chemical"],
  },
  UTILITY: {
    words: /\b(gas leak|lpg|cylinder|smell of gas|live wire|electric(al)? (pole|wire|shock)|electrocut\w*|transformer|power line|short circuit|sparking)\b/,
    labels: ["Power Lines", "Electrical Device", "Cylinder"],
  },
};

const CRITICAL_PATTERNS = [
  /\bnot breathing\b/,
  /\bno pulse\b/,
  /\b(dead|died|death|fatal)\b/,
  /\btrapped\b/,
  /\b(heavy|severe) bleeding\b|\bbleeding (heavily|a lot)\b/,
  /\bexplosion\b/,
  /\bmass casualt/,
  /\bbuilding collapse|collapsed building\b/,
];

const SERIOUS_PATTERNS = [
  /\bunconscious\b/,
  /\bbleeding\b/,
  /\bfracture|broken (leg|arm|bone)\b/,
  /\bburns?\b/,
  /\bchest pain|heart attack|stroke\b/,
  /\b(spreading|spread) fast\b/,
  /\bchildren?\b|\bkids?\b/,
  /\b(stabbed|shot)\b/,
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  several: 3, many: 5, dozens: 24, multiple: 3,
};

/** Best-effort count of people affected, from phrases like "3 injured" or "two people trapped". */
export function estimateCasualties(text: string): number {
  const re = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|several|many|dozens|multiple)\s+(?:\w+\s)?(people|persons|injured|victims|passengers|casualties|children|students|workers|men|women|dead)\b/g;
  let max = 0;
  for (const m of text.matchAll(re)) {
    const raw = m[1]!;
    const n = /^\d+$/.test(raw) ? Number(raw) : (NUMBER_WORDS[raw] ?? 0);
    max = Math.max(max, n);
  }
  if (max === 0 && /\b(injured|hurt|bleeding|unconscious|victim)\b/.test(text)) max = 1;
  return max;
}

export function classifyType(signals: TriageSignals): IncidentType {
  const text = signals.text.toLowerCase();
  const labels = new Set(signals.imageLabels.map((l) => l.toLowerCase()));
  let best: IncidentType = "OTHER";
  let bestScore = 0;
  for (const [type, { words, labels: typeLabels }] of Object.entries(TYPE_KEYWORDS)) {
    const textHits = [...text.matchAll(new RegExp(words.source, "g"))].length;
    const labelHits = typeLabels.filter((l) => labels.has(l.toLowerCase())).length;
    const score = textHits * 2 + labelHits * 3;
    if (score > bestScore) {
      bestScore = score;
      best = type as IncidentType;
    }
  }
  return best;
}

export function scoreSeverity(signals: TriageSignals, type: IncidentType, casualties: number): Severity {
  const text = signals.text.toLowerCase();
  let score = type === "OTHER" ? 1 : 2;
  if (CRITICAL_PATTERNS.some((p) => p.test(text))) score = Math.max(score, 4);
  if (SERIOUS_PATTERNS.some((p) => p.test(text))) score = Math.max(score, 3);
  if (casualties >= 3) score = Math.max(score, 4);
  if (casualties >= 10) score = 5;
  if (CRITICAL_PATTERNS.filter((p) => p.test(text)).length >= 2) score = 5;
  const labels = signals.imageLabels.map((l) => l.toLowerCase());
  if (labels.includes("fire") || labels.includes("explosion")) score = Math.max(score, 3);
  if (type === "NATURAL_DISASTER" || type === "HAZMAT") score = Math.max(score, 3);
  return Math.min(5, score) as Severity;
}

/** Which services must act for an incident of this type and severity. */
export function requiredAgentsFor(type: IncidentType, severity: Severity, casualties: number): AgentName[] {
  const agents = new Set<AgentName>();
  const injuries = casualties > 0 || severity >= 3;
  switch (type) {
    case "ROAD_ACCIDENT":
      agents.add("TRAFFIC_POLICE");
      if (injuries) agents.add("AMBULANCE");
      if (severity >= 4) agents.add("POLICE");
      break;
    case "MEDICAL":
      agents.add("AMBULANCE");
      break;
    case "FIRE":
      agents.add("FIRE");
      if (injuries) agents.add("AMBULANCE");
      if (severity >= 3) agents.add("POLICE");
      break;
    case "NATURAL_DISASTER":
      agents.add("DISASTER_RESPONSE").add("FIRE").add("AMBULANCE").add("POLICE");
      break;
    case "CRIME":
      agents.add("POLICE");
      if (injuries) agents.add("AMBULANCE");
      break;
    case "HARASSMENT":
      agents.add("WOMEN_CHILD_SAFETY").add("POLICE");
      if (casualties > 0) agents.add("AMBULANCE");
      break;
    case "HAZMAT":
      agents.add("FIRE").add("POLICE").add("AMBULANCE");
      break;
    case "UTILITY":
      agents.add("UTILITY_EMERGENCY");
      if (severity >= 3) agents.add("FIRE");
      if (injuries) agents.add("AMBULANCE");
      break;
    default:
      agents.add("POLICE");
  }
  return normalizeAgents([...agents], severity);
}

const ORDER: AgentName[] = ["AMBULANCE", "HOSPITAL", "FIRE", "POLICE", "TRAFFIC_POLICE", "DISASTER_RESPONSE", "WOMEN_CHILD_SAFETY", "UTILITY_EMERGENCY"];

/** Enforce cross-service invariants regardless of who proposed the list. */
export function normalizeAgents(agents: AgentName[], severity: Severity): AgentName[] {
  const set = new Set(agents);
  if (set.has("AMBULANCE")) set.add("HOSPITAL"); // a patient being transported needs a bed
  if (set.has("AMBULANCE") && severity >= 4) set.add("TRAFFIC_POLICE"); // clear the route for a critical patient
  return ORDER.filter((a) => set.has(a));
}

export function ruleBasedAssessment(signals: TriageSignals): Assessment {
  const detected = classifyType(signals);
  const type = detected === "OTHER" && signals.reportedCategory ? signals.reportedCategory : detected;
  const casualties = estimateCasualties(signals.text.toLowerCase());
  const severity = scoreSeverity(signals, type, casualties);
  const hazards = signals.imageLabels.filter((l) => /fire|smoke|flame|flood|weapon|gun|knife|explosion/i.test(l));
  return {
    incidentType: type,
    severity,
    confidence: detected === "OTHER" ? 40 : 60,
    summary: signals.text.slice(0, 280) || "Emergency reported without description.",
    estimatedCasualties: casualties,
    hazards,
    requiredAgents: requiredAgentsFor(type, severity, casualties),
    recommendations: [],
    source: "RULES_ONLY",
  };
}

/**
 * Combine the AI assessment with the rule baseline. Severity takes the higher
 * of the two (rules are a floor, never a ceiling); agents are the union.
 */
export function mergeAssessments(rules: Assessment, ai: Omit<Assessment, "source">): Assessment {
  const severity = Math.max(rules.severity, ai.severity) as Severity;
  const incidentType = ai.incidentType === "OTHER" ? rules.incidentType : ai.incidentType;
  const casualties = Math.max(rules.estimatedCasualties, ai.estimatedCasualties);
  const requiredAgents = normalizeAgents(
    [...rules.requiredAgents, ...ai.requiredAgents, ...requiredAgentsFor(incidentType, severity, casualties)],
    severity,
  );
  return {
    ...ai,
    incidentType,
    severity,
    estimatedCasualties: casualties,
    hazards: [...new Set([...ai.hazards, ...rules.hazards])],
    requiredAgents,
    source: "BEDROCK+RULES",
  };
}
