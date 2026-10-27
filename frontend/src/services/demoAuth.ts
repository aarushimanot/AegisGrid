// Demo-mode accounts, stored in this browser (shared by all tabs) so every flow
// can be presented before the AWS backend exists. Mirrors services/auth.ts.
//
// Seeded logins:
//   admin@aegisgrid.demo / Admin@123          the platform owner
//   <station>@aegisgrid.demo / Station@123    16 approved Vellore stations
//   newfire@aegisgrid.demo / Station@123      a station application waiting for approval
//   citizen@aegisgrid.demo / Citizen@123      a sample citizen

import type { AccountType, Role, Session, SignInResult, SignUpInput } from './auth';
import { isStrongPassword } from '../utils/password';
import { SEED_PASSWORD, VELLORE_STATIONS, seedEmail } from '@core/vellore-stations';

export interface DemoUser {
  userId: string;
  email: string;
  name: string;
  phone?: string;
  liveLocation: boolean;
  role: Role;
  accountType: AccountType;
  provider: 'password' | 'google';
  passwordHash?: string;
  confirmed: boolean;
  enabled: boolean;
  createdAt: string;
  code?: string;
}

const KEY = 'aegisgrid_demo_users_v2';
export const ADMIN_LOGIN = { email: 'admin@aegisgrid.demo', password: 'Admin@123' };
export const CITIZEN_LOGIN = { email: 'citizen@aegisgrid.demo', password: 'Citizen@123' };
export const APPLICANT_LOGIN = { email: 'newfire@aegisgrid.demo', password: SEED_PASSWORD };
export const stationUserId = (key: string) => `demo-station-${key}`;
export const ADMIN_USER_ID = 'demo-admin';

async function hash(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`aegisgrid:${password}`));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function load(): DemoUser[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as DemoUser[];
  } catch {
    return [];
  }
}
function store(users: DemoUser[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(users));
  } catch {
    // ignore
  }
}

let seeding: Promise<void> | null = null;
/** Create the seeded accounts once. */
export function ensureSeeded(): Promise<void> {
  seeding ??= (async () => {
    const list = load();
    if (list.some(u => u.email === ADMIN_LOGIN.email)) return;
    const now = new Date().toISOString();
    const base = { liveLocation: false, provider: 'password' as const, confirmed: true, enabled: true, createdAt: now };
    const stationHash = await hash(SEED_PASSWORD);
    store([
      ...list,
      { ...base, userId: 'demo-admin', email: ADMIN_LOGIN.email, name: 'AegisGrid Admin', role: 'admin', accountType: 'citizen', passwordHash: await hash(ADMIN_LOGIN.password) },
      { ...base, userId: 'demo-citizen', email: CITIZEN_LOGIN.email, name: 'Ananya Sharma', phone: '+919876543210', liveLocation: true, role: 'citizen', accountType: 'citizen', passwordHash: await hash(CITIZEN_LOGIN.password) },
      { ...base, userId: 'demo-applicant', email: APPLICANT_LOGIN.email, name: 'Gandhi Nagar Fire Post', role: 'applicant', accountType: 'service', passwordHash: stationHash },
      ...VELLORE_STATIONS.map(s => ({ ...base, userId: stationUserId(s.key), email: seedEmail(s.key), name: s.name, role: 'service' as Role, accountType: 'service' as AccountType, passwordHash: stationHash })),
    ]);
  })();
  return seeding;
}

const newCode = () => String(Math.floor(100000 + Math.random() * 900000));
const delay = () => new Promise(r => setTimeout(r, 350));
const norm = (email: string) => email.trim().toLowerCase();

function toSession(u: DemoUser): Session {
  const groups = u.role === 'admin' ? ['Admins'] : u.role === 'service' ? ['ServiceProviders'] : [];
  return {
    userId: u.userId, email: u.email, name: u.name, phone: u.phone, liveLocation: u.liveLocation,
    role: u.role, groups, provider: u.provider, accountType: u.accountType,
    idToken: 'demo', accessToken: 'demo', refreshToken: 'demo', expiresAt: Date.now() + 30 * 86_400_000,
  };
}

// ── used by the demo backend (admin actions, station approval) ──────────────
export function listUsers(): DemoUser[] {
  return load();
}
export function setRole(userId: string, role: Role) {
  const list = load();
  const u = list.find(x => x.userId === userId);
  if (u) { u.role = role; store(list); }
}
export function setEnabled(userId: string, enabled: boolean) {
  const list = load();
  const u = list.find(x => x.userId === userId);
  if (u) { u.enabled = enabled; store(list); }
}
export function deleteUser(userId: string) {
  store(load().filter(u => u.userId !== userId));
}
export function reloadSession(session: Session): Session | null {
  const u = load().find(x => x.userId === session.userId);
  return u && u.enabled ? toSession(u) : null;
}

// ── auth API ────────────────────────────────────────────────────────────────
export async function signUp(input: SignUpInput) {
  await ensureSeeded();
  await delay();
  const list = load();
  const email = norm(input.email);
  const existing = list.find(u => u.email === email);
  if (existing?.confirmed) throw new Error('An account with this email already exists. Sign in instead.');
  if (!isStrongPassword(input.password)) throw new Error('Password does not meet the requirements.');
  const code = newCode();
  const user: DemoUser = {
    userId: existing?.userId ?? `demo-${crypto.randomUUID()}`, email, name: input.name.trim(), phone: input.phone,
    liveLocation: input.liveLocation, role: input.accountType === 'service' ? 'applicant' : 'citizen', accountType: input.accountType,
    provider: 'password', passwordHash: await hash(input.password), confirmed: false, enabled: true, createdAt: new Date().toISOString(), code,
  };
  store([...list.filter(u => u.email !== email), user]);
  return { confirmationRequired: true, demoCode: code };
}

export async function confirmSignUp(email: string, code: string) {
  await delay();
  const list = load();
  const u = list.find(x => x.email === norm(email));
  if (!u) throw new Error('Account not found.');
  if (u.code !== code.trim()) throw new Error('That code is not correct.');
  u.confirmed = true;
  delete u.code;
  store(list);
}

export async function resendCode(email: string) {
  const list = load();
  const u = list.find(x => x.email === norm(email));
  if (!u) throw new Error('Account not found.');
  u.code = newCode();
  store(list);
  return { demoCode: u.code };
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  await ensureSeeded();
  await delay();
  const u = load().find(x => x.email === norm(email));
  if (!u || u.provider !== 'password' || u.passwordHash !== (await hash(password))) throw new Error('Incorrect email or password.');
  if (!u.enabled) throw new Error('This account has been disabled by the administrator.');
  if (!u.confirmed) return { status: 'CONFIRM_SIGN_UP' };
  return { status: 'SIGNED_IN', session: toSession(u) };
}

export async function forgotPassword(email: string) {
  await delay();
  const list = load();
  const u = list.find(x => x.email === norm(email) && x.provider === 'password');
  if (!u) return {};
  u.code = newCode();
  store(list);
  return { demoCode: u.code };
}

export async function confirmForgotPassword(email: string, code: string, newPassword: string) {
  await delay();
  const list = load();
  const u = list.find(x => x.email === norm(email));
  if (!u || u.code !== code.trim()) throw new Error('That code is not correct.');
  if (!isStrongPassword(newPassword)) throw new Error('Password does not meet the requirements.');
  u.passwordHash = await hash(newPassword);
  u.confirmed = true;
  delete u.code;
  store(list);
}

export async function changePassword(email: string, oldPassword: string, newPassword: string) {
  await delay();
  const list = load();
  const u = list.find(x => x.email === norm(email));
  if (!u || u.passwordHash !== (await hash(oldPassword))) throw new Error('Current password is incorrect.');
  if (!isStrongPassword(newPassword)) throw new Error('Password does not meet the requirements.');
  u.passwordHash = await hash(newPassword);
  store(list);
}

export function updateProfile(session: Session, changes: { name?: string; phone?: string | null; liveLocation?: boolean }): Session {
  const list = load();
  const u = list.find(x => x.userId === session.userId);
  if (u) {
    if (changes.name !== undefined) u.name = changes.name;
    if (changes.phone !== undefined) u.phone = changes.phone ?? undefined;
    if (changes.liveLocation !== undefined) u.liveLocation = changes.liveLocation;
    store(list);
    return toSession(u);
  }
  return session;
}

/** Simulated Google account (live mode uses Cognito's Google federation). */
export async function googleSignIn(): Promise<Session> {
  await ensureSeeded();
  await delay();
  const list = load();
  let u = list.find(x => x.provider === 'google');
  if (!u) {
    u = { userId: `demo-google-${crypto.randomUUID()}`, email: 'demo.citizen@gmail.com', name: 'Demo Google User', liveLocation: true, role: 'citizen', accountType: 'citizen', provider: 'google', confirmed: true, enabled: true, createdAt: new Date().toISOString() };
    store([...list, u]);
  }
  if (!u.enabled) throw new Error('This account has been disabled by the administrator.');
  return toSession(u);
}
