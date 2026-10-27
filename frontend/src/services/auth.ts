// Accounts for every role:
//   citizen    — self sign-up (email + password, or Google)
//   applicant  — signed up as an emergency service; registration not yet approved
//   service    — a station approved by the admin
//   admin      — the platform owner (created at deployment; never self-registered)
//
// Live mode talks to the backend's Cognito user pool directly through the
// Cognito Identity Provider JSON API (no SDK needed), plus Cognito's hosted
// OAuth endpoints for "Continue with Google". Demo mode keeps accounts in this
// browser (services/demoAuth.ts) so every flow can be tried before deployment.

import { config, isLiveMode } from '../config';
import * as demo from './demoAuth';

export type Role = 'citizen' | 'applicant' | 'service' | 'admin';
export type AccountType = 'citizen' | 'service';

export interface Session {
  userId: string;
  email: string;
  name: string;
  phone?: string;
  /** Consent to use live GPS when no location is typed (custom:live_location). */
  liveLocation: boolean;
  role: Role;
  groups: string[];
  provider: 'password' | 'google';
  accountType: AccountType;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export interface SignUpInput {
  email: string;
  password: string;
  name: string;
  phone?: string;
  liveLocation: boolean;
  accountType: AccountType;
}

export type SignInResult =
  | { status: 'SIGNED_IN'; session: Session }
  | { status: 'NEW_PASSWORD_REQUIRED'; challengeSession: string }
  | { status: 'CONFIRM_SIGN_UP' };

export function roleFromGroups(groups: string[], accountType?: string): Role {
  if (groups.includes('Admins')) return 'admin';
  if (groups.includes('ServiceProviders')) return 'service';
  return accountType === 'service' ? 'applicant' : 'citizen';
}

/** Where each role lands after signing in. */
export const homeFor = (role: Role) =>
  ({ citizen: '/request', applicant: '/service/register', service: '/station', admin: '/admin' })[role];

// ── session storage ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'aegisgrid_session';
// Demo mode keeps the session per browser tab, so a citizen, a station and the
// admin can be signed in side by side in one browser during a presentation.
const store = (): Storage => (isLiveMode ? localStorage : sessionStorage);
let current: Session | null = (() => {
  try {
    const raw = store().getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
})();

const listeners = new Set<(s: Session | null) => void>();
export function onSessionChange(fn: (s: Session | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function save(session: Session | null) {
  current = session;
  try {
    if (session) store().setItem(STORAGE_KEY, JSON.stringify(session));
    else store().removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable: session lasts for this page only
  }
  listeners.forEach(fn => fn(session));
}

export const getSession = () => current;

// ── Cognito helpers (live mode) ─────────────────────────────────────────────

class AuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const FRIENDLY: Record<string, string> = {
  NotAuthorizedException: 'Incorrect email or password.',
  UserNotFoundException: 'Incorrect email or password.',
  UsernameExistsException: 'An account with this email already exists. Sign in instead.',
  CodeMismatchException: 'That code is not correct.',
  ExpiredCodeException: 'That code has expired. Request a new one.',
  InvalidPasswordException: 'Password does not meet the requirements.',
  LimitExceededException: 'Too many attempts. Please wait a few minutes and try again.',
  UserNotConfirmedException: 'Please verify your email first.',
};

async function cognito<T>(target: string, body: object): Promise<T> {
  const res = await fetch(`https://cognito-idp.${config.cognito.region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { __type?: string; message?: string };
  if (!res.ok) {
    const code = (data.__type ?? '').split('#').pop() ?? 'Error';
    throw new AuthError(code, FRIENDLY[code] ?? data.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

interface Tokens { IdToken: string; AccessToken: string; RefreshToken?: string; ExpiresIn: number }
interface AuthResult { AuthenticationResult?: Tokens; ChallengeName?: string; Session?: string }

function decodeJwt(token: string): Record<string, unknown> {
  const payload = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(atob(payload).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  return JSON.parse(json);
}

function sessionFromTokens(t: Tokens, refreshToken: string): Session {
  const c = decodeJwt(t.IdToken);
  const groups = (c['cognito:groups'] as string[] | undefined) ?? [];
  const identities = c.identities as { providerName?: string }[] | undefined;
  const accountType = (c['custom:account_type'] as AccountType | undefined) ?? 'citizen';
  return {
    userId: String(c.sub),
    email: String(c.email ?? ''),
    name: String(c.name ?? c.email ?? ''),
    phone: c.phone_number as string | undefined,
    liveLocation: c['custom:live_location'] === 'true',
    role: roleFromGroups(groups, accountType),
    groups,
    provider: identities?.some(i => i.providerName === 'Google') ? 'google' : 'password',
    accountType,
    idToken: t.IdToken,
    accessToken: t.AccessToken,
    refreshToken,
    expiresAt: Date.now() + t.ExpiresIn * 1000,
  };
}

/** Fetch fresh tokens, e.g. after the admin approves a station (new group membership). */
export async function refreshSession(): Promise<Session | null> {
  if (!isLiveMode) {
    if (!current) return null;
    const s = demo.reloadSession(current);
    save(s);
    return s;
  }
  return refresh();
}

async function refresh(): Promise<Session | null> {
  if (!current) return null;
  try {
    const res = await cognito<AuthResult>('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: config.cognito.clientId,
      AuthParameters: { REFRESH_TOKEN: current.refreshToken },
    });
    const s = sessionFromTokens(res.AuthenticationResult!, current.refreshToken);
    save(s);
    return s;
  } catch {
    save(null);
    return null;
  }
}

/** A valid ID token for API calls, refreshed shortly before it expires. */
export async function getIdToken(): Promise<string | null> {
  if (!isLiveMode) return current ? 'demo' : null;
  if (!current) return null;
  if (Date.now() < current.expiresAt - 60_000) return current.idToken;
  return (await refresh())?.idToken ?? null;
}

// ── public API (each call works in live and demo mode) ──────────────────────

export async function signUp(input: SignUpInput): Promise<{ confirmationRequired: boolean; demoCode?: string }> {
  if (!isLiveMode) return demo.signUp(input);
  const attrs = [
    { Name: 'email', Value: input.email },
    { Name: 'name', Value: input.name },
    { Name: 'custom:live_location', Value: input.liveLocation ? 'true' : 'false' },
    { Name: 'custom:account_type', Value: input.accountType },
    ...(input.phone ? [{ Name: 'phone_number', Value: input.phone }] : []),
  ];
  const res = await cognito<{ UserConfirmed: boolean }>('SignUp', {
    ClientId: config.cognito.clientId, Username: input.email, Password: input.password, UserAttributes: attrs,
  });
  return { confirmationRequired: !res.UserConfirmed };
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  if (!isLiveMode) {
    await demo.confirmSignUp(email, code);
    const u = demo.listUsers().find(x => x.email === email.trim().toLowerCase());
    if (u) void import('./demoBackend').then(m => m.recordDemoActivity(u.userId, 'ACCOUNT', 'ACCOUNT_CREATED', `Account created (${u.accountType === 'service' ? 'emergency service' : 'citizen'}, email and password)`));
    return;
  }
  await cognito('ConfirmSignUp', { ClientId: config.cognito.clientId, Username: email, ConfirmationCode: code.trim() });
}

export async function resendCode(email: string): Promise<{ demoCode?: string }> {
  if (!isLiveMode) return demo.resendCode(email);
  await cognito('ResendConfirmationCode', { ClientId: config.cognito.clientId, Username: email });
  return {};
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  if (!isLiveMode) {
    const r = await demo.signIn(email, password);
    if (r.status === 'SIGNED_IN') {
      save(r.session);
      // Live mode records this with a Cognito Post Authentication trigger.
      void import('./demoBackend').then(m => m.recordDemoActivity(r.session.userId, 'ACCOUNT', 'SIGNED_IN', 'Signed in with email and password'));
    }
    return r;
  }
  try {
    const res = await cognito<AuthResult>('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH', ClientId: config.cognito.clientId, AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    if (res.ChallengeName === 'NEW_PASSWORD_REQUIRED' && res.Session) return { status: 'NEW_PASSWORD_REQUIRED', challengeSession: res.Session };
    if (!res.AuthenticationResult) throw new AuthError('Unsupported', `Unsupported sign-in step: ${res.ChallengeName}`);
    const session = sessionFromTokens(res.AuthenticationResult, res.AuthenticationResult.RefreshToken ?? '');
    save(session);
    return { status: 'SIGNED_IN', session };
  } catch (err) {
    if ((err as AuthError).code === 'UserNotConfirmedException') return { status: 'CONFIRM_SIGN_UP' };
    throw err;
  }
}

/** First sign-in of an account an admin created: Cognito requires a new password. */
export async function completeNewPassword(email: string, newPassword: string, challengeSession: string): Promise<Session> {
  const res = await cognito<AuthResult>('RespondToAuthChallenge', {
    ChallengeName: 'NEW_PASSWORD_REQUIRED', ClientId: config.cognito.clientId, Session: challengeSession,
    ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
  });
  const session = sessionFromTokens(res.AuthenticationResult!, res.AuthenticationResult!.RefreshToken ?? '');
  save(session);
  return session;
}

export async function forgotPassword(email: string): Promise<{ demoCode?: string }> {
  if (!isLiveMode) return demo.forgotPassword(email);
  await cognito('ForgotPassword', { ClientId: config.cognito.clientId, Username: email });
  return {};
}

export async function confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void> {
  if (!isLiveMode) {
    await demo.confirmForgotPassword(email, code, newPassword);
    const u = demo.listUsers().find(x => x.email === email.trim().toLowerCase());
    if (u) void import('./demoBackend').then(m => m.recordDemoActivity(u.userId, 'ACCOUNT', 'PASSWORD_RESET', 'Password reset with a code sent to the account email'));
    return;
  }
  // Live mode records the reset with the Cognito Post Confirmation trigger.
  await cognito('ConfirmForgotPassword', { ClientId: config.cognito.clientId, Username: email, ConfirmationCode: code.trim(), Password: newPassword });
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  if (!current) throw new Error('Not signed in');
  const userId = current.userId;
  if (!isLiveMode) {
    await demo.changePassword(current.email, oldPassword, newPassword);
    void import('./demoBackend').then(m => m.recordDemoActivity(userId, 'ACCOUNT', 'PASSWORD_CHANGED', 'Password changed'));
    return;
  }
  // Straight to Cognito, so the password never passes through the AegisGrid backend;
  // only the fact that it changed is recorded afterwards.
  await cognito('ChangePassword', { AccessToken: current.accessToken, PreviousPassword: oldPassword, ProposedPassword: newPassword });
  const api = await import('./aegisApi');
  await api.recordPasswordChanged().catch(() => undefined);
}

export async function updateProfile(changes: { name?: string; phone?: string | null; liveLocation?: boolean }): Promise<Session> {
  if (!current) throw new Error('Not signed in');
  if (!isLiveMode) {
    const before = current;
    const s = demo.updateProfile(current, changes);
    save(s);
    void import('./demoBackend').then(m => m.recordProfileUpdate(before, s));
    return s;
  }
  // Through the backend (not straight to Cognito) so every change is recorded in the activity history.
  const api = await import('./aegisApi');
  await api.updateMyAccount(changes);
  return (await refresh()) ?? current; // new ID token carries the updated attributes
}

export function signOut(): void {
  save(null);
}

// ── Google (Cognito hosted OAuth, authorization code + PKCE) ────────────────

const PKCE_KEY = 'aegisgrid_pkce';
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const redirectUri = () => `${window.location.origin}/auth/callback`;

export const googleSignInAvailable = () => !isLiveMode || (config.cognito.googleSignIn && !!config.cognito.domain);

export async function startGoogleSignIn(): Promise<void> {
  if (!isLiveMode) {
    window.location.assign('/auth/callback?demo=google');
    return;
  }
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    identity_provider: 'Google',
    response_type: 'code',
    client_id: config.cognito.clientId,
    redirect_uri: redirectUri(),
    scope: 'openid email profile aws.cognito.signin.user.admin',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  window.location.assign(`https://${config.cognito.domain}/oauth2/authorize?${params}`);
}

/** Handle /auth/callback: exchange the authorization code for tokens. */
export async function completeGoogleSignIn(search: URLSearchParams): Promise<Session> {
  if (!isLiveMode) {
    const s = await demo.googleSignIn();
    save(s);
    void import('./demoBackend').then(m => m.recordDemoActivity(s.userId, 'ACCOUNT', 'SIGNED_IN', 'Signed in with Google'));
    return s;
  }
  const error = search.get('error_description') ?? search.get('error');
  if (error) throw new Error(error);
  const stored = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? '{}') as { verifier?: string; state?: string };
  sessionStorage.removeItem(PKCE_KEY);
  if (!stored.verifier || stored.state !== search.get('state')) throw new Error('Sign-in session expired. Please try again.');
  const res = await fetch(`https://${config.cognito.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: config.cognito.clientId, code: search.get('code') ?? '',
      redirect_uri: redirectUri(), code_verifier: stored.verifier,
    }),
  });
  const t = (await res.json()) as { id_token?: string; access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !t.id_token) throw new Error(t.error ?? 'Google sign-in failed');
  const session = sessionFromTokens({ IdToken: t.id_token, AccessToken: t.access_token!, ExpiresIn: t.expires_in ?? 3600 }, t.refresh_token ?? '');
  save(session);
  return session;
}
