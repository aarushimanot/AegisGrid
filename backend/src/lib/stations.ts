// Stations table: registered help-service stations (one per service account).

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./aws";
import { config } from "./config";
import type { ServiceType, Station, StationStatus } from "./types";

export async function getStation(stationId: string): Promise<Station | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: config.stationsTable, Key: { stationId }, ConsistentRead: true }));
  return res.Item as Station | undefined;
}

export async function putStation(station: Station): Promise<void> {
  await ddb.send(new PutCommand({ TableName: config.stationsTable, Item: station }));
}

/** Approved stations of one service type (the candidates for dispatch). */
export async function listApproved(serviceType: ServiceType): Promise<Station[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: config.stationsTable,
      IndexName: "ByTypeStatus",
      KeyConditionExpression: "serviceType = :t AND #status = :s",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":t": serviceType, ":s": "APPROVED" },
    }),
  );
  return (res.Items ?? []) as Station[];
}

/** Every station (admin views). A city has at most a few hundred, so a scan is fine. */
export async function listAllStations(status?: StationStatus): Promise<Station[]> {
  const items: Station[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(new ScanCommand({ TableName: config.stationsTable, ExclusiveStartKey: cursor }));
    items.push(...((res.Items ?? []) as Station[]));
    cursor = res.LastEvaluatedKey;
  } while (cursor);
  return status ? items.filter((s) => s.status === status) : items;
}

/** Commit one unit (crew / vehicle / bed). False when none is free. */
export async function reserveUnit(stationId: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: config.stationsTable,
        Key: { stationId },
        UpdateExpression: "SET unitsAvailable = unitsAvailable - :one, updatedAt = :now",
        ConditionExpression: "unitsAvailable > :zero AND #status = :approved",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":one": 1, ":zero": 0, ":approved": "APPROVED", ":now": new Date().toISOString() },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

/** Return a unit after the job (never above the station's total). */
export async function releaseUnit(stationId: string): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: config.stationsTable,
        Key: { stationId },
        UpdateExpression: "SET unitsAvailable = unitsAvailable + :one, updatedAt = :now",
        ConditionExpression: "unitsAvailable < unitsTotal",
        ExpressionAttributeValues: { ":one": 1, ":now": new Date().toISOString() },
      }),
    );
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }
}

export async function bumpStats(stationId: string, field: keyof Station["stats"], by = 1): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: config.stationsTable,
      Key: { stationId },
      UpdateExpression: "SET stats.#f = if_not_exists(stats.#f, :zero) + :by",
      ExpressionAttributeNames: { "#f": field },
      ExpressionAttributeValues: { ":zero": 0, ":by": by },
    }),
  );
}
