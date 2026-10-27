// Publishing to the AegisGrid EventBridge bus — the backbone agents use to collaborate.

import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { eventBridge } from "./aws";
import { config } from "./config";
import { log } from "./logger";

export async function publish(source: string, detailType: string, detail: object): Promise<void> {
  const res = await eventBridge.send(
    new PutEventsCommand({
      Entries: [{ EventBusName: config.eventBusName, Source: source, DetailType: detailType, Detail: JSON.stringify(detail) }],
    }),
  );
  if (res.FailedEntryCount && res.FailedEntryCount > 0) {
    const entry = res.Entries?.[0];
    throw new Error(`EventBridge rejected ${detailType}: ${entry?.ErrorCode} ${entry?.ErrorMessage}`);
  }
  log.info("Event published", { source, detailType });
}
