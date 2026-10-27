// The citizen's own account standing and phone verification.
//
//   GET  /me/profile         trust score, standing, verified phone
//   POST /me/phone/send      {phone}: send a one-time code to that number
//   POST /me/phone/verify    {code}: confirm it (required before the first request)

import { logActivity } from "../../lib/activity";
import { requireCaller } from "../../lib/auth";
import { ensureProfile, profileView, putProfile } from "../../lib/citizens";
import { newOtp } from "../../lib/core";
import { apiHandler, HttpError, json, parseBody } from "../../lib/http";
import { deliverCode, hashCode } from "../../lib/otp-delivery";
import { CodeSchema, PhoneSendSchema } from "../../lib/validation";

export const handler = apiHandler(async (event) => {
  const caller = requireCaller(event, ["citizen"]);
  const profile = await ensureProfile(caller.userId, { email: caller.email, name: caller.name });

  if (event.httpMethod === "GET") return json(200, { profile: profileView(profile) });

  if (event.resource === "/me/phone/send") {
    const { phone } = parseBody(event, PhoneSendSchema);
    const last = profile.phoneOtp ? Date.parse(profile.phoneOtp.expiresAt) - 10 * 60_000 : 0;
    if (Date.now() - last < 30_000) throw new HttpError(429, "Please wait 30 seconds before requesting another code");
    const code = newOtp();
    profile.phoneOtp = { hash: hashCode(code, `${caller.userId}:${phone}`), phone, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), attempts: 0 };
    profile.updatedAt = new Date().toISOString();
    await putProfile(profile);
    const delivery = await deliverCode(phone, caller.email ?? "", code, "phone verification");
    await logActivity(caller.userId, { category: "VERIFICATION", action: "PHONE_CODE_SENT", summary: `Verification code sent to ${phone} (${delivery.channel})` });
    return json(200, delivery);
  }

  if (event.resource === "/me/phone/verify") {
    const { code } = parseBody(event, CodeSchema);
    const otp = profile.phoneOtp;
    if (!otp || Date.parse(otp.expiresAt) < Date.now()) throw new HttpError(400, "Code expired. Request a new one.");
    if (otp.attempts >= 5) throw new HttpError(429, "Too many attempts. Request a new code.");
    if (hashCode(code, `${caller.userId}:${otp.phone}`) !== otp.hash) {
      profile.phoneOtp = { ...otp, attempts: otp.attempts + 1 };
      await putProfile(profile);
      await logActivity(caller.userId, { category: "VERIFICATION", action: "PHONE_CODE_WRONG", summary: "Wrong phone verification code entered" });
      throw new HttpError(400, "Code does not match");
    }
    profile.phone = otp.phone;
    profile.phoneVerified = true;
    delete profile.phoneOtp;
    profile.updatedAt = new Date().toISOString();
    profile.history = [...profile.history, { at: profile.updatedAt, event: "PHONE_VERIFIED" }].slice(-50);
    await putProfile(profile);
    await logActivity(caller.userId, { category: "VERIFICATION", action: "PHONE_VERIFIED", summary: `Mobile number ${otp.phone} verified` });
    return json(200, { profile: profileView(profile) });
  }

  throw new HttpError(404, "Not found");
});
