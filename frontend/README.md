# AegisGrid Frontend

React + Vite + Tailwind UI for AegisGrid: a citizen emergency-reporting portal plus responder screens (Dashboard, Incidents, Agent Monitor, Analytics).

## Run

```bash
npm install
npm run dev
```

### Demo mode vs live mode

- **Demo mode** is the default: when no `.env.local` is present, the full system runs inside the browser (see below). The header shows **DEMO DATA**.
- **Live mode** connects to the AWS backend in `../backend`. Copy `.env.example` to `.env.local` and fill it in from the `sam deploy` outputs:

  ```
  VITE_API_URL=<ApiUrl output>
  VITE_COGNITO_USER_POOL_ID=<UserPoolId output>
  VITE_COGNITO_CLIENT_ID=<UserPoolClientId output>
  ```

  Restart `npm run dev`. The header now shows **LIVE · AWS**.

**What changes in live mode:**
- **Report Emergency.**
  - The report goes to `POST /incidents`, and photos, video and the voice note upload straight to S3 through pre-signed URLs.
  - An address you type is converted to coordinates via OpenStreetMap.
  - The confirmation screen keeps checking `GET /incidents/{id}/status`, so the reporter sees the AI assessment and each agent's dispatch with ETAs.
- **Responder pages** require a Cognito sign-in at `/login`. The first sign-in asks the user to set a new password. Data refreshes every 15 s.
- **Incident detail** shows the real agent timeline, what each agent dispatched, the AI-written responder briefings (Bedrock) and whether triage came from Bedrock or the rules alone. It also has a **Mark Resolved** button that releases the units.
- **Dashboard, Analytics and Agent Monitor** compute every number from the real incidents and the resource fleet: ambulances available, free hospital beds, signals holding green corridors.

**Accounts and screens.** Everyone signs in at `/login`, and the app adapts to the account:
- **Citizen** (sign up with email + password, or Google). Screens:
  - **Request Help:** text, photos, video and voice notes, with no service picker. Includes one-click **demonstration scenarios**.
  - **Request tracking:** each service's station, accept/transfer status, ETA and the **one-time codes** to give the responder.
  - **My Requests:** history with response times.
  - **Services:** the 8 services and their verified stations.
  - **Account:** profile, live-location consent and password.
- **Emergency service** (sign up as "Emergency service"):
  - **Registration wizard:** service type, organisation, registration number, map-pinned address, documents, phone code and declaration, then waiting for admin approval.
  - **Station console** once approved: incoming requests with a countdown, Accept/Transfer, and arrival/completion code entry. Also history and profile.
- **Admin** (only the platform owner):
  - **Command Center:** live map of all stations and requests, plus alerts.
  - **All Requests:** reassign, close, audit timeline.
  - **Service Stations:** verify documents; approve, reject, suspend.
  - **Users:** disable, enable, delete.
  - **Agent Monitor** and **Analytics**.

**Demo mode** runs the complete workflow in the browser on the backend's own dispatch logic, imported from `../backend/src/lib` via the `@core` alias:
- **Shared data:** every tab of the browser sees the same data.
- **Separate logins:** each tab keeps its own sign-in. Open the citizen, a station and the admin side by side, and changes appear in the other tabs instantly.
- **Seeded logins:**
  - `admin@aegisgrid.demo` / `Admin@123`
  - `citizen@aegisgrid.demo` / `Citizen@123`
  - 16 stations as `<key>@aegisgrid.demo` / `Station@123` (e.g. `katpadi-fire`, `vellore-fire`, `katpadi-108`, `cmc-er`)
  - a pending application, `newfire@aegisgrid.demo` / `Station@123`

**Live location.** At sign-up, citizens choose whether AegisGrid may use their live location. If they leave the location empty when requesting help, the device's GPS is used and kept updated for responders until the request is resolved.

**Live map.** The Dashboard and each incident page show a live operations map: incidents, ambulances, police, fire engines, hospitals and traffic signals, with a line from each assigned unit to its incident and a dashed line from the scene to the receiving hospital. Layers can be toggled on and off.
- By default the map uses free OpenStreetMap tiles.
- Add `VITE_GOOGLE_MAPS_API_KEY` to `.env.local` to switch to **Google Maps**, which adds a *Live traffic* layer. Google needs a billing account on Google Cloud, but the Maps JavaScript API has a monthly free allowance that a project demo stays well within.

**Where the integration code lives:**
- `src/config.ts`: environment settings
- `src/services/auth.ts`: Cognito sign-in
- `src/services/aegisApi.ts`: API client
- `src/services/mappers.ts`: converts backend records to the UI's types
- `src/services/liveAgents.ts`: Agent Monitor data
- `src/utils/liveAnalytics.ts`: chart and KPI data

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
