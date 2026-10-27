// Incidents table repository.

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./aws";
import { config } from "./config";
import type { Assessment, CitizenStanding, Credibility, Incident, IncidentStatus, ServiceAssignment, ServiceType } from "./types";

export async function createIncident(incident: Incident): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: config.incidentsTable,
      Item: incident,
      ConditionExpression: "attribute_not_exists(incidentId)",
    }),
  );
}

export async function getIncident(incidentId: string): Promise<Incident | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: config.incidentsTable, Key: { incidentId }, ConsistentRead: true }));
  return res.Item as Incident | undefined;
}

export async function mustGetIncident(incidentId: string): Promise<Incident> {
  const incident = await getIncident(incidentId);
  if (!incident) throw new Error(`Incident ${incidentId} not found`);
  return incident;
}

/**
 * Move an incident to a new status. When `from` is given the transition only
 * happens if the incident is currently in one of those states; returns false
 * if it was not.
 */
export async function setStatus(incidentId: string, status: IncidentStatus, from?: IncidentStatus[]): Promise<boolean> {
  const values: Record<string, unknown> = { ":s": status, ":now": new Date().toISOString() };
  let condition = "attribute_exists(incidentId)";
  if (from?.length) {
    const keys = from.map((f, i) => {
      values[`:f${i}`] = f;
      return `:f${i}`;
    });
    condition += ` AND #status IN (${keys.join(",")})`;
  }
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: config.incidentsTable,
        Key: { incidentId },
        UpdateExpression: "SET #status = :s, updatedAt = :now",
        ConditionExpression: condition,
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: values,
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

export async function saveAnalysis(incidentId: string, analysis: Incident["analysis"]): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: config.incidentsTable,
      Key: { incidentId },
      UpdateExpression: "SET analysis = :a, updatedAt = :now",
      ExpressionAttributeValues: { ":a": analysis, ":now": new Date().toISOString() },
    }),
  );
}

export async function saveAssessment(incidentId: string, assessment: Assessment): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: config.incidentsTable,
      Key: { incidentId },
      UpdateExpression: "SET assessment = :a, #status = :s, severity = :sev, incidentType = :t, updatedAt = :now",
      ConditionExpression: "#status <> :resolved",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":a": assessment,
        ":s": "ASSESSED",
        ":sev": assessment.severity,
        ":t": assessment.incidentType,
        ":resolved": "RESOLVED",
        ":now": new Date().toISOString(),
      },
    }),
  );
}

/** Store the credibility check; a duplicate is closed and linked to the original report. */
export async function saveIntegrity(incidentId: string, credibility: Credibility, standing?: CitizenStanding, duplicateOf?: string): Promise<void> {
  const now = new Date().toISOString();
  const values: Record<string, unknown> = { ":c": credibility, ":now": now, ":rs": standing ?? "GOOD" };
  let update = "SET credibility = :c, reporterStanding = :rs, updatedAt = :now";
  if (duplicateOf) {
    update += ", duplicateOf = :d, #status = :resolved, resolvedAt = :now, outcome = :o";
    Object.assign(values, { ":d": duplicateOf, ":resolved": "RESOLVED", ":o": "DUPLICATE" });
  }
  await ddb.send(
    new UpdateCommand({
      TableName: config.incidentsTable,
      Key: { incidentId },
      UpdateExpression: update,
      ...(duplicateOf ? { ExpressionAttributeNames: { "#status": "status" } } : {}),
      ExpressionAttributeValues: values,
    }),
  );
}

/**
 * Write one service's assignment. With `expectOfferId`, only succeeds if the
 * assignment still refers to that offer (guards against racing transitions).
 */
export async function setAssignment(
  incidentId: string,
  type: ServiceType,
  assignment: ServiceAssignment,
  opts: { expectOfferId?: string; incidentStatus?: IncidentStatus; firstArrivalAt?: string } = {},
): Promise<boolean> {
  const names: Record<string, string> = { "#t": type, "#status": "status" };
  const values: Record<string, unknown> = { ":a": assignment, ":now": new Date().toISOString(), ":resolved": "RESOLVED" };
  const sets = ["assignments.#t = :a", "updatedAt = :now"];
  if (opts.incidentStatus) {
    sets.push("#status = :st");
    values[":st"] = opts.incidentStatus;
  }
  if (opts.firstArrivalAt) {
    sets.push("firstArrivalAt = if_not_exists(firstArrivalAt, :fa)");
    values[":fa"] = opts.firstArrivalAt;
  }
  let condition = "attribute_exists(incidentId) AND #status <> :resolved";
  if (opts.expectOfferId) {
    condition += " AND assignments.#t.offerId = :oid";
    values[":oid"] = opts.expectOfferId;
  }
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: config.incidentsTable,
        Key: { incidentId },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: condition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

export async function markResolved(incidentId: string, outcome: NonNullable<Incident["outcome"]> = "SERVED"): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: config.incidentsTable,
        Key: { incidentId },
        UpdateExpression: "SET #status = :resolved, resolvedAt = :now, updatedAt = :now, outcome = :o",
        ConditionExpression: "attribute_exists(incidentId) AND #status <> :resolved",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":resolved": "RESOLVED", ":now": now, ":o": outcome },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

export async function listByStatus(status: IncidentStatus, limit = 50, cursor?: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: config.incidentsTable,
      IndexName: "ByStatus",
      KeyConditionExpression: "#status = :s",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":s": status },
      ScanIndexForward: false, // newest first
      Limit: limit,
      ExclusiveStartKey: cursor ? JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) : undefined,
    }),
  );
  return {
    items: (res.Items ?? []) as Incident[],
    nextCursor: res.LastEvaluatedKey ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64url") : undefined,
  };
}


/** A citizen's own requests, newest first (ByReporter index). */
export async function listByReporter(reporterId: string, limit = 50): Promise<Incident[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: config.incidentsTable,
      IndexName: "ByReporter",
      KeyConditionExpression: "reporterId = :r",
      ExpressionAttributeValues: { ":r": reporterId },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (res.Items ?? []) as Incident[];
}

/** Live-location update from the citizen's device while help is on the way. */
export async function updateLiveLocation(incidentId: string, reporterId: string, lat: number, lon: number): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: config.incidentsTable,
        Key: { incidentId },
        UpdateExpression: "SET #location = :loc, locationUpdatedAt = :now, updatedAt = :now",
        ConditionExpression: "reporterId = :r AND locationSource = :gps AND #status <> :resolved",
        ExpressionAttributeNames: { "#location": "location", "#status": "status" },
        ExpressionAttributeValues: { ":loc": { lat, lon }, ":r": reporterId, ":gps": "gps", ":resolved": "RESOLVED", ":now": new Date().toISOString() },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}
