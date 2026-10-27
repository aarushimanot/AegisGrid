# AegisGrid Backend

AI-powered multi-agent emergency response platform on AWS (BCSE355L Cloud Architecture Design course project).

AegisGrid has three kinds of account:
- **Citizens** request help.
- **Emergency service stations** register and pass verification.
- **The admin** is the platform owner, with full control.

**How a request flows:**
1. A citizen uploads proof: text, photos, video or a voice note. They type a location, or the app uses their live GPS.
2. AWS AI services analyse the report.
3. A generative model on Amazon Bedrock (Amazon Nova by default, Claude optional), working together with a deterministic rule engine, decides which of the **eight services** are needed.
4. For each needed service, that service's **agent** offers the request to the **nearest approved, on-duty station** with free capacity. Distance is measured from the station's registered address to the citizen.
5. The station must **accept** within 90 seconds. If it **transfers** the request ("all crews busy") or doesn't answer in time, the request moves automatically to the next nearest station of the same service.
6. On arrival the responder enters the citizen's **one-time arrival code**. That confirms the right team reached the right person and records the **response time** (request sent → verified arrival).
7. A **new completion code** closes the job.

## Architecture

```
Citizen app ──► API Gateway (Cognito) ──► create-incident ──► DynamoDB (Incidents)
                   │                            └─► pre-signed S3 uploads (evidence)
                   └─► Step Functions: incident-analysis
                         Rekognition (photos) ║ Transcribe (voice/video) → Translate → Comprehend
                         → assess-incident: Bedrock + rules → required services
                         → EventBridge: Incident.Assessed
                                   │  one rule per service (detail.requiredAgents)
     ┌──────────┬────────┬────────┬───────────┬──────────┬───────────┬──────────────┬──────────────┐
  Ambulance    Fire    Police   Traffic    Hospital   Disaster   Women & Child   Gas & Electric      ← 8 service agents
     └──────────┴────────┴────────┴─────┬─────┴──────────┴───────────┴──────────────┴──────────────┘
                     nearest approved station → Offer (DynamoDB Offers)
                                         │
   Station console ── accept / transfer ─┤◄── offer-sweeper (every minute): unaccepted → next nearest
                   ── arrive (citizen's code) → response time
                   ── complete (new code)  → unit freed; incident resolved when every service is done
   Admin console   ── verify stations, manage users, see every request, reassign, close
   Notifier (SNS per service, SES to stations) · Event recorder (audit timeline) · DynamoDB Streams → S3 → Glue/Athena
   React app ─► S3 (private) ─► CloudFront (HTTPS)
```

### The eight service agents

| Service | Handles | Registers with |
|---|---|---|
| Ambulance (108) | Medical transport | Ambulance service registration |
| Fire & Rescue (101) | Fires, rescue, trapped persons | Fire station code (TNFRS) |
| Police (100) | Crime, violence, scene security | Police station code (CCTNS) |
| Traffic Police | Road accidents, clearing routes | Traffic unit code |
| Hospital Emergency | Receiving patients, reserving a bed | Clinical Establishment registration |
| Disaster Response | Floods, collapses, landslides | SDRF / NDRF unit code |
| Women & Child Safety | Harassment, abuse, missing children | WCD unit / helpline registration |
| Gas & Electricity Emergency | LPG leaks, live wires, transformers | Utility licence / division code |

**How an agent works:** each agent is its own Lambda function (same code, `SERVICE_TYPE` environment variable) behind its own EventBridge rule.
- **Picking a station:** the agent ranks stations of its service: approved, on duty, with a free unit, within the station's own coverage radius, and not already tried for this request. It then offers the request to the nearest one.
- **Accepting:** this commits a unit with a conditional write, so a station can never be overbooked.
- **Transfer or timeout:** the station is excluded and the next nearest one is offered the request.
- **No station available:** the service is marked unavailable and the admin is alerted to assign one manually.

**Hybrid AI.** The rule engine sets a severity *floor*: the model can raise severity but never lower it below what the rules detect. If Bedrock is unavailable, triage falls back to the rules alone, so an emergency never waits on the model.

**One-time codes.** Every code is a fresh 6-digit code:
- **Arrival code:** generated when a station accepts.
- **Completion code:** generated when arrival is confirmed.
- **Visibility:** only the citizen (and the admin, for support) can see the codes; stations never receive them.
- **Wrong attempts:** after 5 wrong entries, the code rotates.

**Reliability.**
- **At-least-once delivery:** agents are idempotent, using one claim per agent per incident.
- **Conditional transitions:** every offer and assignment change is conditional, so a station, a retry and the sweeper can't corrupt each other's work.
- **Failure handling:** failed event deliveries go to an SQS dead-letter queue (DLQ) with an alarm on it. A failed analysis escalates to the admin.

## Repository layout

```
template.yaml                  SAM template: 30 Lambdas, Step Functions, 5 tables, Cognito, CloudFront, alarms…
statemachine/                  Step Functions definition (ASL)
src/lib/                       Domain code. Pure modules (types, catalog, core, rules, geo, citizen-view,
                               station-view, vellore-stations) are shared with the web app's demo engine.
src/handlers/api/              Citizen API (request help, status, history, live location, services)
src/handlers/station/          Station registration/verification and the station inbox
src/handlers/admin/            Admin API
src/handlers/analysis/         Step Functions tasks (perception + triage)
src/handlers/agents/           service-agent.ts (deployed 8 times, one per service)
src/handlers/platform/         Offer sweeper, notifier, timeline recorder, analytics export
scripts/seed-stations.ts       16 verified Vellore reference stations, each with its own login
scripts/deploy-frontend.sh     Build the React app against the stack and publish it to S3 + CloudFront
scripts/smoke-test.ts          End-to-end test against a deployed stack
tests/                         Unit tests (vitest)
```

## API

The base URL is the `ApiUrl` stack output. Every route needs a Cognito ID token in the `Authorization` header. Roles come from the token: `Admins` group = admin, `ServiceProviders` group = approved station, `custom:account_type=service` without that group = applicant, otherwise citizen.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/incidents` | citizen | Request help (text, `location`, `locationSource`, media). Returns upload URLs |
| POST | `/incidents/{id}/submit` | owner | Start analysis after uploading media |
| GET | `/incidents/{id}/status` | owner | Services, stations, ETAs, one-time codes, response time |
| GET | `/me/incidents` | citizen | Request history with response times |
| GET | `/me/activity` | signed in | The account's own activity history (any role) |
| PATCH | `/me/account` | signed in | Change name, phone or live-location setting (recorded in the history) |
| GET | `/me/profile`, POST `/me/phone/{send,verify}` | citizen | Trust standing; one-time phone verification |
| GET | `/admin/activity/{userId}` | admin | Any account's activity history |
| PATCH | `/me/incidents/{id}/location` | owner | Live GPS updates while help is on the way |
| GET | `/services` | signed in | The 8 services and their verified stations |
| GET/PUT/PATCH | `/station/me` | applicant, station | Registration details; on duty and unit availability |
| POST | `/station/me/{documents, phone-otp, verify-phone, submit}` | applicant | Document uploads, phone code, submit for review |
| GET | `/station/offers` | station | Incoming, active and past requests |
| POST | `/station/offers/{id}/{accept, transfer, arrive, complete}` | station | Accept, transfer, or confirm arrival or completion with the citizen's code |
| GET | `/admin/overview`, `/admin/incidents[/{id}]` | admin | Everything, including codes and the audit timeline |
| POST | `/admin/incidents/{id}/assign`, `/admin/incidents/{id}/resolve` | admin | Reassign a service to a station; close a request |
| GET/POST | `/admin/stations[/{id}[/review]]` | admin | Review documents; approve, reject, suspend, reinstate |
| GET/POST | `/admin/users[/{username}/action]` | admin | List users; disable, enable or delete |

## Cost: built for the AWS Free plan

The stack has **no fixed monthly charges**. Nothing bills by the hour, and an idle stack costs $0.

| Category | Services | Cost |
|---|---|---|
| **Always Free** (within the monthly limits) | Lambda (1M requests); DynamoDB (25 RCU/25 WCU, which the tables are provisioned to exactly); SNS (1M publishes, 1,000 emails); SQS; Step Functions (4,000 transitions); Cognito; CloudWatch (10 alarms, 3 dashboards; this stack uses 7 alarms and 1 dashboard); X-Ray; SSM Parameter Store; EventBridge Scheduler; CloudFront (1 TB, 10M requests); Glue Data Catalog; AWS Budgets | $0 |
| **Pay-per-use, fractions of a cent per incident** | API Gateway; EventBridge custom events; S3; Rekognition; Transcribe; Comprehend; Translate; Bedrock (Amazon Nova Lite); Athena queries | About $0.01 per test incident, paid from the new-account credits ($100–$200). The Free plan never charges your card |

**Swapped out to stay free:**

| Originally | Now | Why |
|---|---|---|
| Customer-managed KMS key | AWS-managed and AWS-owned keys: S3 SSE-S3, DynamoDB default encryption, SNS with `aws/sns` | A customer key costs $1/month; the managed keys are free and still encrypt at rest |
| Secrets Manager | SSM Parameter Store | Secrets Manager costs $0.40 per secret per month; Parameter Store is free, and a SecureString parameter gives encryption |
| Claude on Bedrock | Amazon Nova Lite | Claude is sold through AWS Marketplace, which the Free plan blocks. Nova is billed directly by AWS. Switch back with `BedrockModelId=anthropic.claude-opus-5-5` on a Paid-plan account |
| QuickSight | The frontend's Analytics page, plus Athena on the Glue table | QuickSight is a paid subscription after its trial |
| DynamoDB on-demand + point-in-time recovery | Provisioned capacity inside the free 25/25 units; no point-in-time recovery | Stays within Always Free |
| EventBridge archive | Removed | Archive storage is billed |

**Off by default because they cost money:**
- SMS (`CitizenSms`)
- SES email (`SesSenderEmail`)

**Why serverless instead of EC2 + RDS:** EC2 and RDS bill **every hour they're running**, even when no one is using the app. On the Free plan that steadily eats the credits, and the account closes when they run out. Lambda and DynamoDB cost nothing while idle. The mapping is:
- EC2 backend → API Gateway + Lambda
- RDS database → DynamoDB
- S3 frontend → S3 + CloudFront (CloudFront adds the HTTPS the browser needs for GPS and the microphone)

**Spending alert.** Set `AlarmEmail=you@example.com` and an AWS Budget emails you when spend passes 50% of `MonthlyBudgetUsd` (default $1), or is forecast to exceed it.

## Deploy

**Prerequisites:**
- AWS CLI v2 configured (`aws configure`)
- AWS SAM CLI
- Node.js 22 or later

On macOS without Homebrew, install both into a virtualenv: `python3 -m venv ~/.aegisgrid-tools && ~/.aegisgrid-tools/bin/pip install awscli aws-sam-cli`.

1. **Bedrock model.** Amazon Nova Lite is used by default; Bedrock enables Amazon's serverless models automatically on first use. If your account still has a *Model access* page in the Bedrock console, enable **Nova Lite** there. On a Paid-plan account you can use Claude instead: `BedrockModelId=anthropic.claude-opus-5-5`.
2. **Optional: email.** Verify a sender address in Amazon SES; while the account is in the SES sandbox, recipient addresses must be verified too.
3. Build and deploy (the region is `us-east-1`, which has every service used here, including Nova; see `samconfig.toml`):

   ```bash
   npm install
   npm test
   sam build
   sam deploy --guided      # first time; afterwards just `sam deploy`
   ```

   Useful parameter overrides:
   - `SesSenderEmail=alerts@example.com`
   - `ControlRoomEmail=you@example.com` (SNS email subscription, filtered to control-room alerts)
   - `AdminEmail=you@example.com` (**required**: creates your admin account)
   - `AlarmEmail=you@example.com` (alarms + monthly budget alert; recommended)
   - `CitizenSms=true` (SMS is **not** free; needs SNS SMS production access)
4. **Seed the reference stations.** This creates 16 verified Vellore stations (2 per service), each with its own login: `<key>@aegisgrid.demo` / `Station@123`, for example `katpadi-fire@aegisgrid.demo`.

   ```bash
   STACK=aegisgrid-dev AWS_REGION=us-east-1 npm run seed
   ```

5. **Add department contacts (only if SES is enabled).** Store them encrypted in Parameter Store:

   ```bash
   aws ssm put-parameter --overwrite --type SecureString --name /aegisgrid/dev/department-directory \
     --value '{"CONTROL_ROOM":{"emails":["..."]},"AMBULANCE":{"emails":["..."]}}'
   ```
6. **Accounts.** One Cognito user pool holds every account:

   | Role | How it is created |
   |---|---|
   | **Admin** (platform owner) | Created at deployment from the `AdminEmail` parameter. AWS emails a temporary password. No one can self-register as admin |
   | Emergency service station | Self sign-up as "Emergency service", then verification (below). Becomes active only when the admin approves it |
   | Citizen | Self sign-up (email + password, or Google) |

   Passwords need at least 8 characters, with an uppercase letter, a number and a special symbol.

   **Station verification:**
   1. Service type.
   2. Organisation details and a registration number in the official format for that service.
   3. Physical address pinned on a map, with unit capacity.
   4. Three documents (registration certificate, authority letter, officer ID), stored privately in S3.
   5. A one-time code sent to the station phone: by SMS when `CitizenSms=true`, otherwise by SES email.
   6. A legal declaration.
   7. Admin review of all of the above. Approval adds the account to `ServiceProviders`.

   **Optional: "Continue with Google".**
   1. In Google Cloud Console go to *APIs & Services → Credentials* and create an **OAuth client ID** (type *Web application*).
   2. Add the stack output `GoogleRedirectUri` as an *Authorized redirect URI*.
   3. Redeploy with `GoogleClientId=<id> GoogleClientSecret=<secret>`.

   Google sign-in is free: it counts toward Cognito's free monthly active users.

7. **Run the end-to-end test.** Sign up a citizen on the website first. Scenarios are `accident`, `fire`, `medical`, `harassment` and `gas`:

   ```bash
   STACK=aegisgrid-dev CITIZEN_EMAIL=you@example.com CITIZEN_PASSWORD='…' npm run smoke -- fire
   ```

8. **Publish the web app.** This builds `../frontend` against this stack and uploads it to S3 behind CloudFront. It prints the public HTTPS URL (the `WebsiteUrl` output):

   ```bash
   ./scripts/deploy-frontend.sh
   ```

### Making changes after deployment

Everything can be changed and redeployed at any time; stored data is kept.

- **Backend** (anything in `src/`, `statemachine/` or `template.yaml`): run `sam build && sam deploy` again. CloudFormation updates only what changed, usually in 1 to 3 minutes. Parameter values from the first `--guided` run are saved in `samconfig.toml`.
- **Web app** (anything in `../frontend`): run `./scripts/deploy-frontend.sh` again. It rebuilds, uploads to S3 and clears the CloudFront cache, so the site updates within a minute or two.
- **Settings without code changes:** redeploy with different parameters, e.g. `sam deploy --parameter-overrides CitizenSms=true`.

**Your data is safe across updates.** All five tables and the Cognito user pool have `DeletionPolicy` and `UpdateReplacePolicy` set to `Retain`. Normal edits update them in place, and even a change that would force a replacement (for example renaming a table or changing its key) keeps the old table instead of deleting it. Avoid changing a table's `TableName` or `KeySchema` after go-live: the app would start on a new, empty table.

### Activity history

Every account has a permanent activity log in `TimelineTable` (partition `ACCOUNT#<userId>`), next to the per-request audit timelines. It records:
- **Account:** account created, every sign-in and every forgotten-password reset (Cognito Post Confirmation / Post Authentication triggers); profile edits with old → new values (name, phone, live location are saved through `PATCH /me/account`, which updates Cognito and records the change); password changes; disabled, enabled or deleted by the admin. The log is kept after an account is deleted.
- **Citizen:** each request sent or refused (and why), every step of its handling (assessed, offered, accepted, arrived, completed, false alarm, duplicate), phone verification, trust score changes.
- **Station:** registration steps and documents, phone verification, submission and admin review, every request offered, accepted, transferred, missed, arrived, completed or reported as a false alarm, on/off duty and unit changes.
- **Admin:** every assignment, closure, station review, account action and trust decision.

Citizens see theirs under Account, stations under Station Profile, and the admin can open any account's history from Users.

A password change while signed in still goes from the browser straight to Cognito, so the password never passes through AegisGrid's own code; afterwards the browser records "Password changed" (`POST /me/activity`, which accepts only that one fixed event for the caller's own log). Changing a citizen's phone number makes the account verify the new number before its next request.

To remove everything: empty the media, analytics and web buckets, then run `sam delete`. The five tables and the user pool are retained by design; delete them in the DynamoDB and Cognito consoles if you really want the data gone.

Department subscriptions are added to the `DispatchTopic` with a filter policy. For example, email for the ambulance desk (free up to 1,000 emails a month):

```bash
aws sns subscribe --topic-arn <DispatchTopicArn> --protocol email --notification-endpoint ambulance-desk@example.com \
  --attributes '{"FilterPolicy":"{\"department\":[\"AMBULANCE\"]}"}'
```

## Frontend

The React UI lives in `../frontend`.
- **Deployed:** `scripts/deploy-frontend.sh` publishes it to S3 + CloudFront.
- **Locally:** put the `ApiUrl`, `UserPoolId` and `UserPoolClientId` outputs into `../frontend/.env.local` and run `npm run dev`.

Once the site URL is known, you can lock the API down to it: redeploy with `CorsOrigin=https://<WebsiteUrl domain>`.

## Analytics

Every incident change is written to `s3://<AnalyticsBucket>/incidents/dt=YYYY-MM-DD/` and catalogued as the Glue table `aegisgrid_<stage>.incidents`. The table uses partition projection, so no crawler is needed.

- **Live dashboard:** the frontend's **Analytics** page.
- **SQL:** query the table in the Athena console with workgroup `aegisgrid-<stage>`. Each query costs a fraction of a cent.
- **QuickSight (optional):** on its free trial, create an Athena dataset from that table. Suggested visuals:
   - incidents by type and severity
   - map of `latitude` / `longitude`
   - average `time_to_dispatch_min` and `ambulance_eta_min`
   - AI vs rules-only assessments (`assessment_source`)
   - languages reported

Operational metrics are on the CloudWatch dashboard (stack output `DashboardUrl`), and X-Ray traces cover the full API → Step Functions → Lambda path.

## Security

- **Encryption:** everything is encrypted at rest with no key fees:
  - S3: SSE-S3
  - DynamoDB: AWS-owned keys
  - dispatch SNS topic: AWS-managed KMS key `aws/sns`
  - department directory: Parameter Store SecureString (`aws/ssm`)

  All buckets block public access and deny non-TLS requests. The web bucket is readable only by CloudFront (Origin Access Control).
- **Authorization:** least-privilege IAM role per Lambda, built from SAM policy templates and scoped statements. Cognito protects the responder routes. API Gateway applies throttling.
- **Data exposure:** citizens never touch AWS credentials; uploads use short-lived pre-signed URLs. The public status endpoint returns no reporter details or internal analysis.
- **Prompt injection:** citizen text is passed to the model as untrusted data, with instructions to ignore any commands it contains. The model output is schema-validated, and the rule floor bounds its effect.

## Local development

```bash
npm run typecheck
npm test
sam local invoke AmbulanceAgentFunction -e events/incident-assessed.json   # needs deployed tables + AWS creds
```
