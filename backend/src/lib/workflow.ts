// Starting the Step Functions incident-analysis workflow.

import { ExecutionAlreadyExists, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { sfn } from "./aws";
import { config } from "./config";
import { log } from "./logger";

/** Start analysis for an incident. Idempotent: the execution name is the incident ID. */
export async function startAnalysis(incidentId: string): Promise<void> {
  try {
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: config.stateMachineArn,
        name: incidentId,
        input: JSON.stringify({ incidentId }),
      }),
    );
    log.info("Analysis workflow started", { incidentId });
  } catch (err) {
    if (err instanceof ExecutionAlreadyExists) {
      log.info("Analysis workflow already running", { incidentId });
      return;
    }
    throw err;
  }
}
