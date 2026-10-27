// End-to-end check against a deployed stack: sign in as a citizen, request
// help, and follow the request until stations have been offered / accepted it.
//
//   STACK=aegisgrid-dev CITIZEN_EMAIL=you@example.com CITIZEN_PASSWORD='…' npm run smoke -- [accident|fire|medical|harassment|gas]
//   (create the citizen by signing up on the website first; run npm run seed for the stations)

import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";

const scenario = process.argv[2] ?? "accident";
const stack = process.env.STACK ?? "aegisgrid-dev";
const email = process.env.CITIZEN_EMAIL;
const password = process.env.CITIZEN_PASSWORD;
if (!email || !password) {
  console.error("Set CITIZEN_EMAIL and CITIZEN_PASSWORD (a citizen account created on the website).");
  process.exit(1);
}

const SCENARIOS: Record<string, { description: string; location: { lat: number; lon: number }; address: string }> = {
  accident: { description: "A lorry hit two bikes near VIT main gate. 3 people injured, one is unconscious and bleeding heavily.", location: { lat: 12.9695, lon: 79.1565 }, address: "VIT Main Gate, Katpadi" },
  fire: { description: "Fire in a textile shop at Long Bazaar, thick smoke, spreading fast. People may be inside.", location: { lat: 12.9165, lon: 79.1325 }, address: "Long Bazaar, Vellore" },
  medical: { description: "My grandfather collapsed with severe chest pain and is breathing with difficulty.", location: { lat: 12.94, lon: 79.16 }, address: "Sathuvachari, Vellore" },
  harassment: { description: "A man has been following and harassing me near the Katpadi bus stand.", location: { lat: 12.9716, lon: 79.1378 }, address: "Katpadi Bus Stand" },
  gas: { description: "Strong smell of gas, the LPG cylinder in our hostel kitchen is leaking.", location: { lat: 12.974, lon: 79.15 }, address: "Katpadi, Vellore" },
};

async function main() {
  const res = await new CloudFormationClient({}).send(new DescribeStacksCommand({ StackName: stack }));
  const out = Object.fromEntries((res.Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey!, o.OutputValue!]));
  const auth = await new CognitoIdentityProviderClient({}).send(new InitiateAuthCommand({
    AuthFlow: "USER_PASSWORD_AUTH", ClientId: out.UserPoolClientId!, AuthParameters: { USERNAME: email!, PASSWORD: password! },
  }));
  const token = auth.AuthenticationResult!.IdToken!;
  const api = out.ApiUrl!.replace(/\/$/, "");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, init: RequestInit = {}): Promise<any> => {
    const r = await fetch(`${api}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: token, ...(init.headers ?? {}) } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await r.json()) as any;
    if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(body)}`);
    return body;
  };

  const body = SCENARIOS[scenario];
  if (!body) throw new Error(`Unknown scenario ${scenario}`);
  // Requests need a verified phone. Without SMS/SES the dev stage returns the code directly.
  const { profile } = await call("/me/profile");
  if (!profile.phoneVerified) {
    const sent = await call("/me/phone/send", { method: "POST", body: JSON.stringify({ phone: process.env.CITIZEN_PHONE ?? "+919876543210" }) });
    const code = sent.devCode ?? process.env.PHONE_CODE;
    if (!code) throw new Error(`Code sent by ${sent.channel}; re-run with PHONE_CODE=<code>`);
    await call("/me/phone/verify", { method: "POST", body: JSON.stringify({ code }) });
    console.log("Phone verified");
  }

  const { incidentId } = await call("/incidents", { method: "POST", body: JSON.stringify({ ...body, locationSource: "manual", declarationAccepted: true }) });
  console.log(`Requested help: ${incidentId} (${scenario})`);

  const started = Date.now();
  let last = "";
  while (Date.now() - started < 180_000) {
    const s = await call(`/incidents/${incidentId}/status`);
    const line = `${s.status} | ${s.incidentType ?? "…"} sev ${s.severity ?? "?"} | ` +
      (s.services ?? []).map((x: { serviceName: string; status: string; stationName?: string }) => `${x.serviceName}: ${x.status}${x.stationName ? ` @ ${x.stationName}` : ""}`).join(" · ");
    if (line !== last) {
      console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s] ${line}`);
      last = line;
    }
    if (s.status === "RESOLVED" || (s.services?.length && s.services.every((x: { status: string }) => x.status !== "SEARCHING"))) {
      if (Date.now() - started > 15_000) break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("Open the station console for each listed station to accept, and the citizen app to see the arrival code.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
