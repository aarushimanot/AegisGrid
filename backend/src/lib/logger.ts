// Minimal structured JSON logger. CloudWatch Logs Insights can query every field.

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

const base: Record<string, unknown> = {
  service: process.env.SERVICE_NAME ?? process.env.AWS_LAMBDA_FUNCTION_NAME ?? "aegisgrid",
  stage: process.env.STAGE,
};

function serializeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { message: String(err) };
}

function write(level: Level, message: string, fields: Record<string, unknown> = {}) {
  const entry: Record<string, unknown> = { level, message, ...base, ...fields, timestamp: new Date().toISOString() };
  if (fields.error !== undefined) entry.error = serializeError(fields.error);
  const line = JSON.stringify(entry);
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => write("DEBUG", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write("INFO", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write("WARN", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write("ERROR", msg, f),
  /** Attach fields (e.g. incidentId) to every subsequent line in this invocation. */
  with(fields: Record<string, unknown>) {
    Object.assign(base, fields);
  },
};
