// Per-account activity log: everything a citizen, station or admin account did,
// or that was done to it, kept permanently. Stored in the Timeline table under
// partition "ACCOUNT#<userId>" (the same table as incident timelines, so it adds
// no provisioned capacity).

import { randomUUID } from "node:crypto";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./aws";
import { config } from "./config";
import { log } from "./logger";

export type ActivityCategory = "ACCOUNT" | "REQUEST" | "RESPONSE" | "VERIFICATION" | "OPERATIONS" | "TRUST" | "ADMIN";

export interface ActivityEntry {
  at: string;
  category: ActivityCategory;
  /** Short machine-readable action, e.g. "SIGNED_IN", "OFFER_ACCEPTED". */
  action: string;
  summary: string;
  incidentId?: string;
  /** Who did it, when it was not the account owner (e.g. the admin). */
  by?: string;
  detail?: Record<string, unknown>;
}

const pk = (userId: string) => `ACCOUNT#${userId}`;

/** Append to an account's log. Never throws: auditing must not break the action itself. */
export async function logActivity(userId: string | undefined, entry: Omit<ActivityEntry, "at"> & { at?: string; eventId?: string }): Promise<void> {
  if (!userId) return;
  const at = entry.at ?? new Date().toISOString();
  const { eventId, ...rest } = entry;
  try {
    await ddb.send(new PutCommand({
      TableName: config.timelineTable,
      // The event id makes EventBridge redeliveries overwrite instead of duplicating.
      Item: { incidentId: pk(userId), sk: `ACT#${at}#${eventId ?? randomUUID().slice(0, 8)}`, ...rest, at },
    }));
  } catch (error) {
    log.warn("Could not record account activity", { userId, action: entry.action, error });
  }
}

/** Newest first, paginated with an opaque cursor. */
export async function listActivity(userId: string, limit = 50, cursor?: string): Promise<{ items: ActivityEntry[]; nextCursor?: string }> {
  const res = await ddb.send(new QueryCommand({
    TableName: config.timelineTable,
    KeyConditionExpression: "incidentId = :pk AND begins_with(sk, :p)",
    ExpressionAttributeValues: { ":pk": pk(userId), ":p": "ACT#" },
    ScanIndexForward: false,
    Limit: limit,
    ExclusiveStartKey: cursor ? JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) : undefined,
  }));
  return {
    items: (res.Items ?? []).map(({ incidentId: _pk, sk: _sk, ...e }) => e as ActivityEntry),
    nextCursor: res.LastEvaluatedKey ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64url") : undefined,
  };
}
