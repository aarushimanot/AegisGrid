// Step Functions task: the hybrid AI assessment.
//   rules baseline  ─┐
//                    ├─► merged assessment ─► DynamoDB ─► returned for EventBridge
//   Bedrock (Claude) ┘   (rules act as a severity floor; Bedrock failure ⇒ rules only)
// Then the misuse checks: a duplicate of an open nearby report is linked to it
// instead of dispatching again, and every request gets a credibility score.

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { assessIncident } from "../../lib/bedrock";
import { config } from "../../lib/config";
import { getProfile } from "../../lib/citizens";
import { DETAIL_TYPE, EVENT_SOURCE } from "../../lib/config";
import { publish } from "../../lib/events";
import { listByStatus, mustGetIncident, saveAssessment, saveIntegrity } from "../../lib/incidents";
import { assessCredibility, findDuplicate } from "../../lib/integrity";
import { log } from "../../lib/logger";
import { mergeAssessments, ruleBasedAssessment } from "../../lib/rules";
import type { Assessment, Incident, IncidentAssessedDetail, MediaItem } from "../../lib/types";

/** Client-reported media metadata, overridden by what the server read from the file itself. */
function withServerExif(incident: Incident): MediaItem[] {
  const exif = new Map((incident.analysis?.images ?? []).map((i) => [i.key, i.exif]));
  return incident.media.map((m) => {
    const e = exif.get(m.key);
    if (!e) return m;
    return { ...m, meta: { source: m.meta?.source ?? "gallery", ...m.meta, ...(e.capturedAt ? { capturedAt: e.capturedAt } : {}), ...(e.location ? { location: e.location } : {}) } };
  });
}

export const handler = async (input: { incidentId: string }): Promise<{ publish: boolean; detail: IncidentAssessedDetail | null }> => {
  const incident = await mustGetIncident(input.incidentId);
  log.with({ incidentId: incident.incidentId });

  const text = incident.analysis?.text;
  const imageLabels = [...new Set((incident.analysis?.images ?? []).flatMap((i) => i.labels.map((l) => l.name)))];
  const englishText = text?.translatedText ?? incident.description;
  const rules = ruleBasedAssessment({ text: englishText, imageLabels, reportedCategory: incident.reportedCategory });

  let assessment: Assessment = rules;
  try {
    const ai = await assessIncident({
      incidentId: incident.incidentId,
      description: incident.description,
      translatedText: englishText,
      originalLanguage: text?.originalLanguage ?? "en",
      reportedCategory: incident.reportedCategory,
      transcripts: (incident.analysis?.transcripts ?? []).map((t) => t.text),
      imageLabels,
      entities: text?.entities ?? [],
      keyPhrases: text?.keyPhrases ?? [],
      sentiment: text?.sentiment,
      location: incident.location,
      address: incident.address,
      ruleBaseline: {
        incidentType: rules.incidentType,
        severity: rules.severity,
        estimatedCasualties: rules.estimatedCasualties,
        requiredAgents: rules.requiredAgents,
      },
    });
    assessment = { ...mergeAssessments(rules, ai), modelId: config.bedrockModelId };
  } catch (error) {
    log.warn("Bedrock assessment unavailable, using rule-based triage", { error });
  }

  try {
    await saveAssessment(incident.incidentId, assessment);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      log.info("Incident resolved before assessment finished; not dispatching");
      return { publish: false, detail: null };
    }
    throw err;
  }

  // Duplicate reports: someone nearby already reported the same emergency.
  const open = (await Promise.all((["ASSESSED", "DISPATCHED"] as const).map((st) => listByStatus(st, 100)))).flatMap((r) => r.items);
  const original = findDuplicate(incident, assessment.incidentType, open);

  const profile = incident.reporterId ? await getProfile(incident.reporterId) : undefined;
  const hourAgo = Date.parse(incident.createdAt) - 3_600_000;
  const credibility = assessCredibility({
    text: [englishText, ...(incident.analysis?.transcripts ?? []).map((t) => t.text)].join(" "),
    imageLabels,
    media: withServerExif(incident),
    incidentType: assessment.incidentType,
    aiConfidence: assessment.confidence,
    location: incident.location,
    locationSource: incident.locationSource ?? "manual",
    deviceLocation: incident.deviceLocation,
    createdAt: incident.createdAt,
    profile,
    // Earlier requests in the past hour (create-incident already recorded this one).
    recentRequestCount: Math.max(0, (profile?.recentRequests ?? []).filter((t) => Date.parse(t) > hourAgo).length - 1),
  });
  await saveIntegrity(incident.incidentId, credibility, profile?.standing, original?.incidentId);
  log.info("Credibility assessed", { score: credibility.score, level: credibility.level, flags: credibility.flags });

  if (original) {
    log.info("Duplicate of an open request; linking instead of dispatching", { original: original.incidentId });
    await publish(EVENT_SOURCE.orchestrator, DETAIL_TYPE.duplicateLinked, {
      incidentId: incident.incidentId,
      originalIncidentId: original.incidentId,
      incidentType: assessment.incidentType,
    });
    return { publish: false, detail: null };
  }

  log.info("Incident assessed", {
    incidentType: assessment.incidentType,
    severity: assessment.severity,
    requiredAgents: assessment.requiredAgents,
    source: assessment.source,
  });

  return {
    publish: true,
    detail: {
      incidentId: incident.incidentId,
      incidentType: assessment.incidentType,
      severity: assessment.severity,
      location: incident.location,
      summary: assessment.summary,
      estimatedCasualties: assessment.estimatedCasualties,
      hazards: assessment.hazards,
      requiredAgents: assessment.requiredAgents,
    },
  };
};
