// Offers table: one row per (incident, service, station) attempt. The station's
// inbox, and the queue the sweeper uses to move expired offers on.

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./aws";
import { config } from "./config";
import type { Offer, OfferStatus } from "./types";

export async function putOffer(offer: Offer): Promise<void> {
  await ddb.send(new PutCommand({ TableName: config.offersTable, Item: offer, ConditionExpression: "attribute_not_exists(offerId)" }));
}

export async function getOffer(offerId: string): Promise<Offer | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: config.offersTable, Key: { offerId }, ConsistentRead: true }));
  return res.Item as Offer | undefined;
}

export async function listByStation(stationId: string, limit = 100): Promise<Offer[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: config.offersTable,
      IndexName: "ByStation",
      KeyConditionExpression: "stationId = :s",
      ExpressionAttributeValues: { ":s": stationId },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (res.Items ?? []) as Offer[];
}

/** OFFERED rows whose acceptance window has passed. */
export async function listExpired(nowIso: string): Promise<Offer[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: config.offersTable,
      IndexName: "ByStatusExpiry",
      KeyConditionExpression: "#status = :s AND expiresAt < :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":s": "OFFERED", ":now": nowIso },
    }),
  );
  return (res.Items ?? []) as Offer[];
}

/** Move an offer from one of `from` to `to`. False if it was no longer in those states. */
export async function transitionOffer(offerId: string, from: OfferStatus[], to: OfferStatus, extra: Record<string, unknown> = {}): Promise<boolean> {
  const values: Record<string, unknown> = { ":to": to, ":now": new Date().toISOString() };
  const sets = ["#status = :to", "updatedAt = :now"];
  Object.entries(extra).forEach(([k, v], i) => {
    sets.push(`${k} = :x${i}`);
    values[`:x${i}`] = v;
  });
  const keys = from.map((f, i) => {
    values[`:f${i}`] = f;
    return `:f${i}`;
  });
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: config.offersTable,
        Key: { offerId },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: `#status IN (${keys.join(",")})`,
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
