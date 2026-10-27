// Typed access to the environment variables set in template.yaml.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const config = {
  get stage() {
    return process.env.STAGE ?? "dev";
  },
  get incidentsTable() {
    return required("INCIDENTS_TABLE");
  },
  get stationsTable() {
    return required("STATIONS_TABLE");
  },
  get offersTable() {
    return required("OFFERS_TABLE");
  },
  get citizensTable() {
    return required("CITIZENS_TABLE");
  },
  get userPoolId() {
    return required("USER_POOL_ID");
  },
  get timelineTable() {
    return required("TIMELINE_TABLE");
  },
  get mediaBucket() {
    return required("MEDIA_BUCKET");
  },
  get analyticsBucket() {
    return required("ANALYTICS_BUCKET");
  },
  get eventBusName() {
    return required("EVENT_BUS_NAME");
  },
  get stateMachineArn() {
    return required("STATE_MACHINE_ARN");
  },
  get dispatchTopicArn() {
    return required("DISPATCH_TOPIC_ARN");
  },
  /** SSM Parameter Store name holding the department contact directory (JSON). */
  get directoryParameter() {
    return required("DIRECTORY_PARAMETER");
  },
  get sesSender() {
    return process.env.SES_SENDER ?? "";
  },
  get bedrockModelId() {
    return process.env.BEDROCK_MODEL_ID ?? "amazon.nova-lite-v1:0";
  },
  get bedrockRegion() {
    return process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-east-1";
  },
  /** Agents ask Bedrock for a short responder briefing when true. */
  get agentBriefingsEnabled() {
    return (process.env.AGENT_BRIEFINGS ?? "true") === "true";
  },
  get citizenSmsEnabled() {
    return process.env.CITIZEN_SMS === "true";
  },
  get uploadUrlTtlSeconds() {
    return Number(process.env.UPLOAD_URL_TTL ?? 900);
  },
};

/** Event source names used on the AegisGrid bus. */
export const EVENT_SOURCE = {
  orchestrator: "aegisgrid.orchestrator",
  agent: (agent: string) => `aegisgrid.agent.${agent.toLowerCase()}`,
  station: "aegisgrid.station",
  admin: "aegisgrid.admin",
  api: "aegisgrid.api",
} as const;

export const DETAIL_TYPE = {
  incidentAssessed: "Incident.Assessed",
  incidentAnalysisFailed: "Incident.AnalysisFailed",
  incidentResolved: "Incident.Resolved",
  offerCreated: "Offer.Created",
  offerAccepted: "Offer.Accepted",
  offerTransferred: "Offer.Transferred",
  offerExpired: "Offer.Expired",
  serviceArrived: "Service.Arrived",
  serviceCompleted: "Service.Completed",
  serviceUnavailable: "Service.Unavailable",
  stationSubmitted: "Station.Submitted",
  stationReviewed: "Station.Reviewed",
  falseAlarm: "Service.FalseAlarm",
  duplicateLinked: "Incident.DuplicateLinked",
} as const;
