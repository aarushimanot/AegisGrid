// Timeline table: an append-only audit log of everything that happened to an
// incident, plus idempotency "claims" so each agent acts once per incident even
// though EventBridge delivers at-least-once.

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./aws";
import { config } from "./config";

export interface TimelineEntry {
  incidentId: string;
  sk: string;
  at: string;
  source: string;
  detailType: string;
  eventId?: string;
  summary: string;
  detail?: unknown;
}

/**
 * Returns true the first time it is called for (incidentId, taskKey) and false
 * on every repeat, making agent handlers idempotent.
 */
export async function claimTask(incidentId: string, taskKey: string): Promise<boolean> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: config.timelineTable,
        Item: { incidentId, sk: `CLAIM#${taskKey}`, at: new Date().toISOString() },
        ConditionExpression: "attribute_not_exists(sk)",
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

/** Undo a claim when the task failed, so the EventBridge retry can run it again. */
export async function releaseTask(incidentId: string, taskKey: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: config.timelineTable, Key: { incidentId, sk: `CLAIM#${taskKey}` } }));
}

export async function appendTimeline(entry: Omit<TimelineEntry, "sk">): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: config.timelineTable,
      Item: { ...entry, sk: `EVENT#${entry.at}#${entry.eventId ?? Math.random().toString(36).slice(2)}` },
    }),
  );
}

export async function getTimeline(incidentId: string): Promise<TimelineEntry[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: config.timelineTable,
      KeyConditionExpression: "incidentId = :id AND begins_with(sk, :p)",
      ExpressionAttributeValues: { ":id": incidentId, ":p": "EVENT#" },
    }),
  );
  return (res.Items ?? []) as TimelineEntry[];
}
