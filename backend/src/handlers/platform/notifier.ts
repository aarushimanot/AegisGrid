// Notifier — turns bus events into real-time alerts:
//   • Amazon SNS topic, with a `department` message attribute so each department
//     subscribes (SMS, email, HTTPS, mobile push) using a filter policy
//   • Amazon SES email to the department contacts kept in SSM Parameter Store
//   • optional SMS to the citizen once help is on the way

import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { PublishCommand } from "@aws-sdk/client-sns";
import type { EventBridgeEvent } from "aws-lambda";
import { GetParameterCommand } from "@aws-sdk/client-ssm";
import { ses, sns, ssm } from "../../lib/aws";
import { config } from "../../lib/config";
import { getIncident } from "../../lib/incidents";
import { log } from "../../lib/logger";
import { renderEvent, type Department } from "../../lib/messages";
import { getStation } from "../../lib/stations";

type Directory = Partial<Record<Department, { emails?: string[] }>>;

let directory: { value: Directory; loadedAt: number } | undefined;
async function getDirectory(): Promise<Directory> {
  if (directory && Date.now() - directory.loadedAt < 5 * 60_000) return directory.value;
  // WithDecryption lets the directory be stored as a SecureString (encrypted with the aws/ssm KMS key).
  const res = await ssm.send(new GetParameterCommand({ Name: config.directoryParameter, WithDecryption: true }));
  directory = { value: JSON.parse(res.Parameter?.Value ?? "{}") as Directory, loadedAt: Date.now() };
  return directory.value;
}

export const handler = async (event: EventBridgeEvent<string, Record<string, unknown>>) => {
  const rendered = renderEvent(event["detail-type"], event.detail);
  if (!rendered) return;
  log.with({ incidentId: event.detail.incidentId, detailType: event["detail-type"] });

  const subject = rendered.subject.slice(0, 100); // SNS subject limit

  await Promise.all(
    rendered.departments.map((department) =>
      sns.send(
        new PublishCommand({
          TopicArn: config.dispatchTopicArn,
          Subject: subject,
          Message: rendered.body,
          MessageAttributes: {
            department: { DataType: "String", StringValue: department },
            severity: { DataType: "Number", StringValue: String(rendered.severity) },
          },
        }),
      ),
    ),
  );

  if (config.sesSender) {
    const dir = await getDirectory();
    const to = [...new Set(rendered.departments.flatMap((d) => dir[d]?.emails ?? []))];
    if (to.length) {
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: config.sesSender,
          Destination: { ToAddresses: to },
          Content: { Simple: { Subject: { Data: rendered.subject }, Body: { Text: { Data: rendered.body } } } },
        }),
      );
    }
  }

  // Station email for new requests, and an optional SMS to the citizen once help is accepted.
  if (event["detail-type"] === "Offer.Created" && config.sesSender && typeof event.detail.stationId === "string") {
    const station = await getStation(event.detail.stationId);
    if (station?.officialEmail) {
      await ses.send(new SendEmailCommand({
        FromEmailAddress: config.sesSender,
        Destination: { ToAddresses: [station.officialEmail] },
        Content: { Simple: { Subject: { Data: rendered.subject }, Body: { Text: { Data: rendered.body } } } },
      }));
    }
  }
  if (config.citizenSmsEnabled && event["detail-type"] === "Offer.Accepted") {
    const incident = await getIncident(String(event.detail.incidentId));
    const phone = incident?.reporter?.phone;
    if (phone) {
      await sns.send(new PublishCommand({
        PhoneNumber: phone,
        Message: `AegisGrid: ${String(event.detail.stationName)} is on the way, ETA ~${String(event.detail.etaMinutes ?? "?")} min. Ref ${String(event.detail.incidentId).slice(0, 8).toUpperCase()}`,
        MessageAttributes: { "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" } },
      }));
    }
  }

  log.info("Notifications sent", { departments: rendered.departments });
};
