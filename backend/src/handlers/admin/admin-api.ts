// Admin API — the platform owner's full control and visibility.
//
//   GET  /admin/overview
//   GET  /admin/incidents?status=ACTIVE|<status>      GET /admin/incidents/{id}
//   POST /admin/incidents/{id}/assign  {serviceType, stationId}
//   POST /admin/incidents/{id}/resolve {note}
//   GET  /admin/stations?status=                      GET /admin/stations/{id}  (with document links)
//   POST /admin/stations/{id}/review   {action: approve|reject|suspend|reinstate, note}
//   GET  /admin/users                                 POST /admin/users/{username}/action {action: disable|enable|delete}
//   POST /admin/citizens/{userId}/standing  {action: reset|suspend|reinstate|reverse_false_alarm, note}
//   GET  /admin/activity/{userId}?cursor=     any account's activity history
// Every admin action is also written to the admin's own activity log.

import {
  AdminAddUserToGroupCommand, AdminDeleteUserCommand, AdminDisableUserCommand, AdminEnableUserCommand,
  AdminRemoveUserFromGroupCommand, ListUsersCommand, ListUsersInGroupCommand, type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { listActivity, logActivity } from "../../lib/activity";
import { ADMIN_GROUP, requireCaller, SERVICE_GROUP } from "../../lib/auth";
import { cognito, s3 } from "../../lib/aws";
import { toAdminView } from "../../lib/citizen-view";
import { listProfiles, profileView, recordTrust } from "../../lib/citizens";
import { config, DETAIL_TYPE, EVENT_SOURCE } from "../../lib/config";
import { adminAssign, cancelIncident } from "../../lib/dispatch";
import { publish } from "../../lib/events";
import { apiHandler, HttpError, json, parseBody } from "../../lib/http";
import { getIncident, listByStatus, markResolved } from "../../lib/incidents";
import { toStationView } from "../../lib/station-view";
import { getStation, listAllStations, putStation } from "../../lib/stations";
import { getTimeline } from "../../lib/timeline";
import type { Incident, IncidentStatus } from "../../lib/types";
import { AssignSchema, ResolveIncidentSchema, ReviewSchema, StandingSchema, UserActionSchema } from "../../lib/validation";

const STATUSES: IncidentStatus[] = ["AWAITING_MEDIA", "ANALYZING", "ASSESSED", "DISPATCHED", "RESOLVED", "FAILED"];
const ACTIVE: IncidentStatus[] = ["ANALYZING", "ASSESSED", "DISPATCHED", "FAILED"];

async function incidents(status: string, limit: number): Promise<Incident[]> {
  const list = status === "ACTIVE" ? ACTIVE : status === "ALL" ? STATUSES : [status as IncidentStatus];
  const pages = await Promise.all(list.map((s) => listByStatus(s, limit)));
  return pages.flatMap((p) => p.items).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

async function groupMembers(group: string): Promise<Set<string>> {
  const names = new Set<string>();
  let token: string | undefined;
  do {
    const res = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: config.userPoolId, GroupName: group, NextToken: token }));
    res.Users?.forEach((u) => u.Username && names.add(u.Username));
    token = res.NextToken;
  } while (token);
  return names;
}

const attr = (u: UserType, name: string) => u.Attributes?.find((a) => a.Name === name)?.Value;

async function users() {
  const all: UserType[] = [];
  let token: string | undefined;
  do {
    const res = await cognito.send(new ListUsersCommand({ UserPoolId: config.userPoolId, PaginationToken: token, Limit: 60 }));
    all.push(...(res.Users ?? []));
    token = res.PaginationToken;
  } while (token && all.length < 1000);
  const [admins, services, profiles] = await Promise.all([groupMembers(ADMIN_GROUP), groupMembers(SERVICE_GROUP), listProfiles()]);
  const bySub = new Map(profiles.map((pr) => [pr.userId, profileView(pr)]));
  return all.map((u) => {
    const username = u.Username!;
    const accountType = attr(u, "custom:account_type") ?? "citizen";
    return {
      username,
      userId: attr(u, "sub"),
      email: attr(u, "email"),
      name: attr(u, "name"),
      phone: attr(u, "phone_number"),
      role: admins.has(username) ? "admin" : services.has(username) ? "service" : accountType === "service" ? "applicant" : "citizen",
      enabled: u.Enabled ?? true,
      status: u.UserStatus,
      createdAt: u.UserCreateDate?.toISOString(),
      provider: username.startsWith("google_") ? "google" : "password",
      profile: bySub.get(attr(u, "sub") ?? ""),
    };
  });
}

export const handler = apiHandler(async (event: APIGatewayProxyEvent) => {
  const admin = requireCaller(event, ["admin"]);
  const route = `${event.httpMethod} ${event.resource}`;
  const p = event.pathParameters ?? {};
  const q = event.queryStringParameters ?? {};
  const audit = (summary: string, extra: { incidentId?: string; detail?: Record<string, unknown> } = {}) =>
    logActivity(admin.userId, { category: "ADMIN", action: route.split(" ")[1]!.split("/").pop()!.toUpperCase(), summary, ...extra });

  switch (route) {
    case "GET /admin/overview": {
      const [all, stations] = await Promise.all([incidents("ALL", 500), listAllStations()]);
      const active = all.filter((i) => i.status !== "RESOLVED");
      const arrivals = all.map((i) => (i.firstArrivalAt ? (Date.parse(i.firstArrivalAt) - Date.parse(i.createdAt)) / 60_000 : null)).filter((n): n is number => n !== null);
      const unassigned = active.filter((i) => Object.values(i.assignments ?? {}).some((a) => a!.status === "UNAVAILABLE")).length;
      return json(200, {
        incidents: { total: all.length, active: active.length, resolved: all.length - active.length, unassigned },
        avgResponseMinutes: arrivals.length ? Math.round((arrivals.reduce((a, b) => a + b, 0) / arrivals.length) * 10) / 10 : null,
        stations: {
          total: stations.length,
          approved: stations.filter((s) => s.status === "APPROVED").length,
          pending: stations.filter((s) => s.status === "PENDING_REVIEW").length,
          onDuty: stations.filter((s) => s.status === "APPROVED" && s.onDuty).length,
        },
      });
    }

    case "GET /admin/incidents": {
      const list = await incidents((q.status ?? "ACTIVE").toUpperCase(), Math.min(500, Number(q.limit ?? 200) || 200));
      return json(200, { items: list.map(toAdminView) });
    }
    case "GET /admin/incidents/{incidentId}": {
      const [incident, timeline] = await Promise.all([getIncident(p.incidentId!), getTimeline(p.incidentId!)]);
      if (!incident) throw new HttpError(404, "Incident not found");
      return json(200, { incident: toAdminView(incident), timeline });
    }
    case "POST /admin/incidents/{incidentId}/assign": {
      const { serviceType, stationId } = parseBody(event, AssignSchema);
      const assignment = await adminAssign(p.incidentId!, serviceType, stationId, admin.email);
      await audit(`Assigned ${serviceType.toLowerCase().replace(/_/g, " ")} for request #${p.incidentId!.slice(0, 8).toUpperCase()} to ${assignment.stationName}`, { incidentId: p.incidentId });
      return json(200, { assignment });
    }
    case "POST /admin/incidents/{incidentId}/resolve": {
      const { note } = parseBody(event, ResolveIncidentSchema);
      const released = await cancelIncident(p.incidentId!, note);
      await markResolved(p.incidentId!, "CLOSED_BY_ADMIN");
      await publish(EVENT_SOURCE.admin, DETAIL_TYPE.incidentResolved, { incidentId: p.incidentId, note, resolvedBy: admin.email, releasedUnits: released });
      await audit(`Closed request #${p.incidentId!.slice(0, 8).toUpperCase()}${note ? `: ${note}` : ""}`, { incidentId: p.incidentId });
      return json(200, { incidentId: p.incidentId, status: "RESOLVED", releasedUnits: released });
    }

    case "GET /admin/stations": {
      const list = await listAllStations(q.status as never);
      return json(200, { items: list.map(toStationView).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    case "GET /admin/stations/{stationId}": {
      const station = await getStation(p.stationId!);
      if (!station) throw new HttpError(404, "Station not found");
      const documents = await Promise.all(station.verification.documents.map(async (d) => ({
        ...d, url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: config.mediaBucket, Key: d.key }), { expiresIn: 600 }),
      })));
      return json(200, { station: { ...toStationView(station), documents } });
    }
    case "POST /admin/stations/{stationId}/review": {
      const { action, note } = parseBody(event, ReviewSchema);
      const station = await getStation(p.stationId!);
      if (!station) throw new HttpError(404, "Station not found");
      const now = new Date().toISOString();
      const allowed: Record<string, string[]> = { approve: ["PENDING_REVIEW"], reject: ["PENDING_REVIEW"], suspend: ["APPROVED"], reinstate: ["SUSPENDED", "REJECTED"] };
      if (!allowed[action]!.includes(station.status)) throw new HttpError(409, `Cannot ${action} a station that is ${station.status.toLowerCase().replace("_", " ")}`);
      const username = station.ownerUserId;
      if (action === "approve" || action === "reinstate") {
        await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: config.userPoolId, Username: username, GroupName: SERVICE_GROUP })).catch(async () => {
          // Federated/email usernames differ from sub; look the user up by sub
          const res = await cognito.send(new ListUsersCommand({ UserPoolId: config.userPoolId, Filter: `sub = "${station.ownerUserId}"`, Limit: 1 }));
          await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: config.userPoolId, Username: res.Users![0]!.Username!, GroupName: SERVICE_GROUP }));
        });
        station.status = "APPROVED";
        station.onDuty = true;
      } else if (action === "suspend") {
        const res = await cognito.send(new ListUsersCommand({ UserPoolId: config.userPoolId, Filter: `sub = "${station.ownerUserId}"`, Limit: 1 }));
        const u = res.Users?.[0]?.Username;
        if (u) await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: config.userPoolId, Username: u, GroupName: SERVICE_GROUP }));
        station.status = "SUSPENDED";
        station.onDuty = false;
      } else {
        station.status = "REJECTED";
      }
      station.verification.reviewedAt = now;
      station.verification.reviewedBy = admin.email;
      station.verification.reviewNote = note;
      station.updatedAt = now;
      await putStation(station);
      await publish(EVENT_SOURCE.admin, DETAIL_TYPE.stationReviewed, { stationId: station.stationId, name: station.name, action, note });
      await audit(`Station ${station.name}: ${action}${note ? ` (${note})` : ""}`, { detail: { stationId: station.stationId } });
      return json(200, { station: toStationView(station) });
    }

    case "GET /admin/users":
      return json(200, { items: await users() });
    case "POST /admin/users/{username}/action": {
      const { action } = parseBody(event, UserActionSchema);
      const username = decodeURIComponent(p.username!);
      const admins = await groupMembers(ADMIN_GROUP);
      if (admins.has(username)) throw new HttpError(403, "The admin account cannot be changed here");
      const input = { UserPoolId: config.userPoolId, Username: username };
      const target = (await cognito.send(new ListUsersCommand({ UserPoolId: config.userPoolId, Filter: `username = "${username.replace(/"/g, "")}"`, Limit: 1 }))).Users?.[0];
      const sub = target ? attr(target, "sub") : undefined;
      const DONE = { disable: "disabled", enable: "re-enabled", delete: "deleted" } as const;
      // Logged before a delete: the account's history is kept after the account is gone.
      await logActivity(sub, { category: "ACCOUNT", action: `ACCOUNT_${action.toUpperCase()}D`, summary: `Account ${DONE[action]} by the admin`, by: admin.email });
      await audit(`Account ${username} ${DONE[action]}`, { detail: { userId: sub } });
      if (action === "disable") await cognito.send(new AdminDisableUserCommand(input));
      if (action === "enable") await cognito.send(new AdminEnableUserCommand(input));
      if (action === "delete") await cognito.send(new AdminDeleteUserCommand(input));
      return json(200, { username, action });
    }
    case "POST /admin/citizens/{userId}/standing": {
      const { action, note } = parseBody(event, StandingSchema);
      const EVENT = { reset: "RESET", suspend: "SUSPEND", reinstate: "REINSTATE", reverse_false_alarm: "FALSE_ALARM_REVERSED" } as const;
      const userId = decodeURIComponent(p.userId!);
      const profile = await recordTrust(userId, EVENT[action], note ? `Admin note: ${note}` : undefined, admin.email);
      await audit(`Citizen ${profile.email ?? userId}: ${action.replace(/_/g, " ")}${note ? ` (${note})` : ""}`, { detail: { userId } });
      return json(200, { profile: profileView(profile) });
    }
    case "GET /admin/activity/{userId}":
      return json(200, await listActivity(decodeURIComponent(p.userId!), Math.min(100, Number(q.limit ?? 50) || 50), q.cursor));
    default:
      throw new HttpError(404, `No route ${route}`);
  }
});
