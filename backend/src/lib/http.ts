// API Gateway helpers: consistent JSON responses, CORS headers and error mapping.

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { ZodError, type ZodType } from "zod";
import { log } from "./logger";

export class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly details?: unknown) {
    super(message);
  }
}

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN ?? "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
};

export const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

export function parseBody<T>(event: APIGatewayProxyEvent, schema: ZodType<T>): T {
  let raw: unknown;
  try {
    const text = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : event.body;
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  return schema.parse(raw);
}

export function pathParam(event: APIGatewayProxyEvent, name: string): string {
  const value = event.pathParameters?.[name];
  if (!value) throw new HttpError(400, `Missing path parameter '${name}'`);
  return value;
}

/** Wrap a handler so thrown errors become well-formed HTTP responses. */
export function apiHandler(fn: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      return await fn(event);
    } catch (err) {
      if (err instanceof ZodError) {
        return json(400, { error: "ValidationError", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
      }
      if (err instanceof HttpError) return json(err.statusCode, { error: err.message, details: err.details });
      log.error("Unhandled API error", { error: err, path: event.path, method: event.httpMethod });
      return json(500, { error: "Internal server error" });
    }
  };
}
