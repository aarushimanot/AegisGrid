// The signed-in account (any role): profile changes and activity history.
//
//   GET   /me/activity?cursor=   own activity history, newest first
//   POST  /me/activity           {event: PASSWORD_CHANGED}: recorded after the browser
//                                changed the password with Cognito directly, so the
//                                password itself never passes through this backend
//   PATCH /me/account            {name?, phone?, liveLocation?}: updates Cognito and records
//                                old → new. A citizen's new phone must be verified again.

import { AdminDeleteUserAttributesCommand, AdminUpdateUserAttributesCommand } from "@aws-sdk/client-cognito-identity-provider";
import { listActivity, logActivity } from "../../lib/activity";
import { requireCaller } from "../../lib/auth";
import { cognito } from "../../lib/aws";
import { getProfile, putProfile } from "../../lib/citizens";
import { config } from "../../lib/config";
import { apiHandler, HttpError, json, parseBody } from "../../lib/http";
import { AccountUpdateSchema, ClientActivitySchema } from "../../lib/validation";

export const handler = apiHandler(async (event) => {
  const caller = requireCaller(event);
  const route = `${event.httpMethod} ${event.resource}`;

  if (route === "GET /me/activity") {
    const q = event.queryStringParameters ?? {};
    return json(200, await listActivity(caller.userId, Math.min(100, Number(q.limit ?? 50) || 50), q.cursor));
  }

  if (route === "POST /me/activity") {
    parseBody(event, ClientActivitySchema);
    await logActivity(caller.userId, { category: "ACCOUNT", action: "PASSWORD_CHANGED", summary: "Password changed", detail: { reportedBy: "browser" } });
    return json(201, { recorded: true });
  }

  if (route === "PATCH /me/account") {
    const req = parseBody(event, AccountUpdateSchema);
    if (!caller.username) throw new HttpError(400, "Account username missing from the sign-in token");
    const user = { UserPoolId: config.userPoolId, Username: caller.username };
    const changes: string[] = [];
    const attrs: { Name: string; Value: string }[] = [];
    if (req.name !== undefined && req.name !== caller.name) {
      attrs.push({ Name: "name", Value: req.name });
      changes.push(`name "${caller.name ?? ""}" → "${req.name}"`);
    }
    if (req.phone && req.phone !== caller.phone) {
      attrs.push({ Name: "phone_number", Value: req.phone });
      changes.push(`phone ${caller.phone ?? "none"} → ${req.phone}`);
    }
    if (req.liveLocation !== undefined && req.liveLocation !== caller.liveLocationConsent) {
      attrs.push({ Name: "custom:live_location", Value: req.liveLocation ? "true" : "false" });
      changes.push(`live location ${req.liveLocation ? "turned on" : "turned off"}`);
    }
    if (attrs.length) await cognito.send(new AdminUpdateUserAttributesCommand({ ...user, UserAttributes: attrs }));
    if (req.phone === null && caller.phone) {
      await cognito.send(new AdminDeleteUserAttributesCommand({ ...user, UserAttributeNames: ["phone_number"] }));
      changes.push(`phone ${caller.phone} removed`);
    }

    // Requests are tied to a verified number: a different number must be verified again.
    let reverify = false;
    if (req.phone !== undefined && caller.role === "citizen") {
      const profile = await getProfile(caller.userId);
      if (profile?.phoneVerified && profile.phone !== req.phone) {
        await putProfile({ ...profile, phoneVerified: false, phone: undefined, updatedAt: new Date().toISOString() });
        reverify = true;
      }
    }

    if (changes.length) {
      await logActivity(caller.userId, {
        category: "ACCOUNT", action: "PROFILE_UPDATED",
        summary: `Profile updated: ${changes.join(", ")}${reverify ? ". The new number must be verified before the next request" : ""}`,
      });
    }
    return json(200, { changed: changes.length, phoneVerificationRequired: reverify });
  }

  throw new HttpError(404, `No route ${route}`);
});
