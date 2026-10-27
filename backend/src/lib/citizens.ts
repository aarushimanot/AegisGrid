// Citizens table: trust score, standing, phone verification and recent request
// times for rate limiting. One item per citizen account.

import { GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { logActivity } from "./activity";
import { ddb } from "./aws";
import { config } from "./config";
import { applyTrust, newProfile, type TrustEvent } from "./integrity";
import type { CitizenProfile } from "./types";

export async function getProfile(userId: string): Promise<CitizenProfile | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: config.citizensTable, Key: { userId }, ConsistentRead: true }));
  return res.Item as CitizenProfile | undefined;
}

/** The citizen's profile, created on first use. */
export async function ensureProfile(userId: string, extra: Partial<CitizenProfile> = {}): Promise<CitizenProfile> {
  const existing = await getProfile(userId);
  if (existing) return existing;
  const p = newProfile(userId, new Date().toISOString(), extra);
  await putProfile(p);
  return p;
}

export async function putProfile(p: CitizenProfile): Promise<void> {
  await ddb.send(new PutCommand({ TableName: config.citizensTable, Item: p }));
}

const TRUST_TEXT: Record<TrustEvent, string> = {
  GENUINE: "Genuine request: trust increased", FALSE_ALARM: "False alarm recorded: trust decreased",
  FALSE_ALARM_REVERSED: "False alarm reversed", RESET: "Trust record reset", SUSPEND: "Requests suspended", REINSTATE: "Requests reinstated",
};

export async function recordTrust(userId: string, event: TrustEvent, note?: string, by?: string): Promise<CitizenProfile> {
  const p = await ensureProfile(userId);
  const next = applyTrust(p, event, new Date().toISOString(), note);
  await putProfile(next);
  await logActivity(userId, {
    category: "TRUST", action: `TRUST_${event}`, by,
    summary: `${TRUST_TEXT[event]} (score ${p.trustScore} → ${next.trustScore}, standing ${next.standing.toLowerCase()})${note ? `. ${note}` : ""}`,
  });
  return next;
}

export async function listProfiles(): Promise<CitizenProfile[]> {
  const items: CitizenProfile[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(new ScanCommand({ TableName: config.citizensTable, ExclusiveStartKey: cursor }));
    items.push(...((res.Items ?? []) as CitizenProfile[]));
    cursor = res.LastEvaluatedKey;
  } while (cursor);
  return items;
}

/** Public part of a profile (never the OTP hash). */
export function profileView(p: CitizenProfile) {
  const { phoneOtp, ...rest } = p;
  void phoneOtp;
  return rest;
}
