// DynamoDB Streams → S3 analytics lake. Each incident is flattened to one JSON
// line (overwritten as it changes) under incidents/dt=YYYY-MM-DD/, which the Glue
// table in template.yaml exposes to Amazon Athena and Amazon QuickSight.

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import type { DynamoDBStreamEvent } from "aws-lambda";
import { s3 } from "../../lib/aws";
import { config } from "../../lib/config";
import type { Incident, ServiceAssignment } from "../../lib/types";

const minutesBetween = (a?: string, b?: string): number | null =>
  a && b ? Math.round(((Date.parse(b) - Date.parse(a)) / 60_000) * 10) / 10 : null;

export function flatten(incident: Incident) {
  const assignments = Object.values(incident.assignments ?? {}).filter(Boolean) as ServiceAssignment[];
  const firstAccept = assignments.map((a) => a.acceptedAt).filter((x): x is string => !!x).sort()[0];
  const resp = (t: string) => assignments.find((a) => a.serviceType === t)?.responseMinutes ?? null;
  return {
    incident_id: incident.incidentId,
    status: incident.status,
    created_at: incident.createdAt,
    updated_at: incident.updatedAt,
    resolved_at: incident.resolvedAt ?? null,
    incident_type: incident.assessment?.incidentType ?? null,
    severity: incident.assessment?.severity ?? null,
    confidence: incident.assessment?.confidence ?? null,
    estimated_casualties: incident.assessment?.estimatedCasualties ?? null,
    assessment_source: incident.assessment?.source ?? null,
    required_services: incident.assessment?.requiredAgents.join(",") ?? null,
    language: incident.analysis?.text?.originalLanguage ?? incident.language ?? null,
    media_count: incident.media?.length ?? 0,
    location_source: incident.locationSource ?? "manual",
    latitude: incident.location?.lat ?? null,
    longitude: incident.location?.lon ?? null,
    stations_accepted: assignments.filter((a) => a.acceptedAt).length,
    transfers: assignments.reduce((n, a) => n + a.tried.length, 0),
    unavailable_services: assignments.filter((a) => a.status === "UNAVAILABLE").length,
    ambulance_response_min: resp("AMBULANCE"),
    fire_response_min: resp("FIRE"),
    police_response_min: resp("POLICE"),
    time_to_accept_min: minutesBetween(incident.createdAt, firstAccept),
    response_time_min: minutesBetween(incident.createdAt, incident.firstArrivalAt),
    time_to_resolve_min: minutesBetween(incident.createdAt, incident.resolvedAt),
  };
}

export const handler = async (event: DynamoDBStreamEvent) => {
  await Promise.all(
    event.Records.filter((r) => r.dynamodb?.NewImage).map(async (r) => {
      const incident = unmarshall(r.dynamodb!.NewImage as Record<string, AttributeValue>) as Incident;
      const row = flatten(incident);
      await s3.send(
        new PutObjectCommand({
          Bucket: config.analyticsBucket,
          Key: `incidents/dt=${incident.createdAt.slice(0, 10)}/${incident.incidentId}.json`,
          Body: JSON.stringify(row) + "\n",
          ContentType: "application/json",
        }),
      );
    }),
  );
};
