// Delivers phone verification codes (station registration and citizen accounts).
//   SMS  (Amazon SNS)  when SMS_ENABLED=true  (costs money; needs SNS SMS production access)
//   Email (Amazon SES) when SES_SENDER is set (free tier; sandbox requires verified recipients)
//   Otherwise, on non-production stages, the code is returned to the caller so the
//   flow can be demonstrated; production refuses to proceed without a channel.

import { createHash } from "node:crypto";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { PublishCommand } from "@aws-sdk/client-sns";
import { ses, sns } from "./aws";
import { config } from "./config";
import { HttpError } from "./http";

export const hashCode = (code: string, salt: string) => createHash("sha256").update(`${salt}:${code}`).digest("hex");

export async function deliverCode(
  phone: string, email: string, code: string, purpose = "service verification",
): Promise<{ channel: "sms" | "email" | "screen"; devCode?: string }> {
  const text = `AegisGrid ${purpose} code: ${code}. It expires in 10 minutes. Do not share it.`;
  if (process.env.SMS_ENABLED === "true") {
    await sns.send(new PublishCommand({ PhoneNumber: phone, Message: text, MessageAttributes: { "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" } } }));
    return { channel: "sms" };
  }
  if (config.sesSender) {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: config.sesSender,
      Destination: { ToAddresses: [email] },
      Content: { Simple: { Subject: { Data: `AegisGrid ${purpose} code` }, Body: { Text: { Data: text } } } },
    }));
    return { channel: "email" };
  }
  if (config.stage === "prod") throw new HttpError(503, "Verification codes cannot be delivered: configure SMS or SES");
  return { channel: "screen", devCode: code };
}
