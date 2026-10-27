import { describe, expect, it } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { callerFrom, parseGroups, requireCaller, roleFromGroups } from "../src/lib/auth";
import { HttpError } from "../src/lib/http";

const eventWith = (claims?: Record<string, unknown>) =>
  ({ requestContext: { authorizer: claims ? { claims } : undefined } }) as unknown as APIGatewayProxyEvent;

describe("parseGroups", () => {
  it("handles the formats API Gateway uses", () => {
    expect(parseGroups("Admins,Dispatchers")).toEqual(["Admins", "Dispatchers"]);
    expect(parseGroups("[Admins Dispatchers]")).toEqual(["Admins", "Dispatchers"]);
    expect(parseGroups(["HospitalStaff"])).toEqual(["HospitalStaff"]);
    expect(parseGroups(undefined)).toEqual([]);
  });
});

describe("roles", () => {
  it("maps groups to roles, admin first", () => {
    expect(roleFromGroups([])).toBe("citizen");
    expect(roleFromGroups(["ServiceProviders"])).toBe("service");
    expect(roleFromGroups(["ServiceProviders", "Admins"])).toBe("admin");
    expect(roleFromGroups([], "service")).toBe("applicant"); // registered as a service, not yet approved
    expect(roleFromGroups([], "citizen")).toBe("citizen");
  });
  it("reads the caller from verified claims", () => {
    const c = callerFrom(eventWith({ sub: "u-1", email: "a@b.in", "custom:live_location": "true" }))!;
    expect(c).toMatchObject({ userId: "u-1", role: "citizen", liveLocationConsent: true });
  });
  it("rejects anonymous and under-privileged callers", () => {
    expect(() => requireCaller(eventWith())).toThrow(HttpError);
    expect(() => requireCaller(eventWith({ sub: "u-1" }), ["service", "admin"])).toThrowError(/access/);
    expect(requireCaller(eventWith({ sub: "u-2", "cognito:groups": "ServiceProviders" }), ["service"]).role).toBe("service");
    expect(() => requireCaller(eventWith({ sub: "u-3", "custom:account_type": "service" }), ["service"])).toThrowError(/access/);
  });
});
