// Who is calling? Roles come from Cognito groups on the ID token, which API
// Gateway's Cognito authorizer has already verified.
//
//   admin      — member of "Admins": the platform owner. Created once at deployment.
//   service    — an approved help-service station (member of "ServiceProviders")
//   applicant  — signed up as a service (custom:account_type = service), not yet approved
//   citizen    — everyone else

import type { APIGatewayProxyEvent } from "aws-lambda";
import { HttpError } from "./http";

export type Role = "citizen" | "applicant" | "service" | "admin";

export const ADMIN_GROUP = "Admins";
export const SERVICE_GROUP = "ServiceProviders";

export interface Caller {
  userId: string;
  /** Cognito username (differs from the sub for Google accounts). */
  username?: string;
  email?: string;
  name?: string;
  phone?: string;
  groups: string[];
  role: Role;
  /** custom:live_location — consent to use live GPS when no location is typed. */
  liveLocationConsent: boolean;
}

/** API Gateway passes cognito:groups as a string ("a,b" or "[a b]") or, in tests, an array. */
export function parseGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.replace(/^\[|\]$/g, "").split(/[,\s]+/).filter(Boolean);
}

export function roleFromGroups(groups: string[], accountType?: string): Role {
  if (groups.includes(ADMIN_GROUP)) return "admin";
  if (groups.includes(SERVICE_GROUP)) return "service";
  return accountType === "service" ? "applicant" : "citizen";
}

export function callerFrom(event: APIGatewayProxyEvent): Caller | undefined {
  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined;
  const sub = claims?.sub;
  if (typeof sub !== "string") return undefined;
  const groups = parseGroups(claims!["cognito:groups"]);
  return {
    userId: sub,
    username: claims!["cognito:username"] as string | undefined,
    email: claims!.email as string | undefined,
    name: claims!.name as string | undefined,
    phone: claims!.phone_number as string | undefined,
    groups,
    role: roleFromGroups(groups, claims!["custom:account_type"] as string | undefined),
    liveLocationConsent: claims!["custom:live_location"] === "true",
  };
}

/** The verified caller, optionally restricted to some roles (403 otherwise). */
export function requireCaller(event: APIGatewayProxyEvent, roles?: Role[]): Caller {
  const caller = callerFrom(event);
  if (!caller) throw new HttpError(401, "Sign in required");
  if (roles && !roles.includes(caller.role)) throw new HttpError(403, "Your account does not have access to this");
  return caller;
}

export const isAdmin = (c: Caller) => c.role === "admin";
