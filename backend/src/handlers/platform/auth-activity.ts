// Cognito triggers: record sign-ups and sign-ins on the account's activity log.
//   PostConfirmation_ConfirmSignUp  → "Account created"
//   PostConfirmation_ConfirmForgotPassword → "Password reset"
//   PostAuthentication_Authentication → "Signed in"
// Cognito waits for this function, so it must always return the event quickly.

import type { PostAuthenticationTriggerEvent, PostConfirmationTriggerEvent } from "aws-lambda";
import { logActivity } from "../../lib/activity";

type TriggerEvent = PostAuthenticationTriggerEvent | PostConfirmationTriggerEvent;

export const handler = async (event: TriggerEvent): Promise<TriggerEvent> => {
  const a = event.request.userAttributes;
  const provider = event.userName.startsWith("google_") ? "Google" : "email and password";
  if (event.triggerSource === "PostConfirmation_ConfirmSignUp") {
    await logActivity(a.sub, {
      category: "ACCOUNT", action: "ACCOUNT_CREATED",
      summary: `Account created (${a["custom:account_type"] === "service" ? "emergency service" : "citizen"}, ${provider})`,
    });
  } else if (event.triggerSource === "PostConfirmation_ConfirmForgotPassword") {
    await logActivity(a.sub, { category: "ACCOUNT", action: "PASSWORD_RESET", summary: "Password reset with a code sent to the account email" });
  } else if (event.triggerSource === "PostAuthentication_Authentication") {
    await logActivity(a.sub, { category: "ACCOUNT", action: "SIGNED_IN", summary: `Signed in with ${provider}` });
  }
  return event;
};
