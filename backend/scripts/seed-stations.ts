// Seed a deployment with the reference Vellore stations, each with its own
// approved service login (<key>@aegisgrid.demo / Station@123).
//
//   STACK=aegisgrid-dev AWS_REGION=us-east-1 npm run seed
//   (reads UserPoolId and StationsTableName from the stack outputs)

import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import {
  AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminGetUserCommand, AdminSetUserPasswordCommand, CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { Station } from "../src/lib/types";
import { SEED_PASSWORD, seedEmail, VELLORE_STATIONS } from "../src/lib/vellore-stations";

const stack = process.env.STACK ?? "aegisgrid-dev";
const cfn = new CloudFormationClient({});
const idp = new CognitoIdentityProviderClient({});
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function outputs(): Promise<Record<string, string>> {
  const res = await cfn.send(new DescribeStacksCommand({ StackName: stack }));
  return Object.fromEntries((res.Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey!, o.OutputValue!]));
}

async function ensureUser(poolId: string, email: string, name: string): Promise<string> {
  try {
    const u = await idp.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: email }));
    return u.UserAttributes!.find((a) => a.Name === "sub")!.Value!;
  } catch {
    const u = await idp.send(new AdminCreateUserCommand({
      UserPoolId: poolId, Username: email, MessageAction: "SUPPRESS",
      UserAttributes: [
        { Name: "email", Value: email }, { Name: "email_verified", Value: "true" }, { Name: "name", Value: name },
        { Name: "custom:account_type", Value: "service" }, { Name: "custom:live_location", Value: "false" },
      ],
    }));
    await idp.send(new AdminSetUserPasswordCommand({ UserPoolId: poolId, Username: email, Password: SEED_PASSWORD, Permanent: true }));
    return u.User!.Attributes!.find((a) => a.Name === "sub")!.Value!;
  }
}

async function main() {
  const out = await outputs();
  const poolId = out.UserPoolId!;
  const table = out.StationsTableName!;
  const now = new Date().toISOString();
  for (const s of VELLORE_STATIONS) {
    const email = seedEmail(s.key);
    const sub = await ensureUser(poolId, email, s.name);
    await idp.send(new AdminAddUserToGroupCommand({ UserPoolId: poolId, Username: email, GroupName: "ServiceProviders" }));
    const station: Station = {
      stationId: sub, ownerUserId: sub, ownerEmail: email, serviceType: s.serviceType, name: s.name,
      registrationNumber: s.registrationNumber, issuingAuthority: s.issuingAuthority, contactPerson: s.contactPerson,
      phone: s.phone, officialEmail: email, address: s.address, location: s.location,
      unitsTotal: s.unitsTotal, unitsAvailable: s.unitsTotal, coverageKm: s.serviceType === "DISASTER_RESPONSE" ? 80 : 30, onDuty: true,
      status: "APPROVED",
      verification: { phoneVerified: true, documents: [], declarationAccepted: true, submittedAt: now, reviewedAt: now, reviewedBy: "seed", reviewNote: "Reference station" },
      stats: { offered: 0, accepted: 0, transferred: 0, completed: 0, totalResponseMinutes: 0 },
      createdAt: now, updatedAt: now,
    };
    await doc.send(new PutCommand({ TableName: table, Item: station }));
    console.log(`✓ ${s.name.padEnd(42)} ${email}`);
  }
  console.log(`\nSeeded ${VELLORE_STATIONS.length} stations. Password for every station login: ${SEED_PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
