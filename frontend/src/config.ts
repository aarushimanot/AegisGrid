// Runtime configuration from Vite env vars (see .env.example).
// Without VITE_API_URL the app runs in demo mode on the bundled mock data.

const env = import.meta.env;
const userPoolId: string = env.VITE_COGNITO_USER_POOL_ID ?? '';

export const config = {
  apiUrl: ((env.VITE_API_URL as string | undefined) ?? '').trim().replace(/\/$/, ''),
  cognito: {
    userPoolId,
    clientId: (env.VITE_COGNITO_CLIENT_ID as string | undefined) ?? '',
    // The pool ID is "<region>_<id>", so the region can be derived from it.
    region: (env.VITE_COGNITO_REGION as string | undefined) || userPoolId.split('_')[0] || 'us-east-1',
    /** Hosted sign-in domain, e.g. aegisgrid-dev-123456789012.auth.us-east-1.amazoncognito.com */
    domain: ((env.VITE_COGNITO_DOMAIN as string | undefined) ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, ''),
    /** "Continue with Google" is shown when the backend has a Google identity provider configured. */
    googleSignIn: (env.VITE_GOOGLE_SIGNIN as string | undefined) === 'true',
  },
  /** Google Maps JavaScript API key. Without it the map uses free OpenStreetMap/CARTO tiles. */
  googleMapsApiKey: ((env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '').trim(),
  /** Map ID from Google Cloud (Map Management); required for Advanced Markers. DEMO_MAP_ID works for testing. */
  googleMapId: ((env.VITE_GOOGLE_MAP_ID as string | undefined) ?? '').trim() || 'DEMO_MAP_ID',
  /** How often responder screens refresh from the API. */
  pollIntervalMs: 15_000,
};

export const isLiveMode = config.apiUrl.length > 0;
