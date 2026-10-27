// One API per role, switching between the AWS backend (live) and the in-browser
// demo engine (demo). Pages only talk to these.

import { isLiveMode } from '../config';
import { getSession } from './auth';
import * as live from './aegisApi';
import { demoActivity, demoAdmin, demoCitizen, demoStation } from './demoBackend';
import type {
  ApiActivityPage, ApiAdminIncident, ApiCitizenRequest, ApiOverview, ApiProfile, ApiServicesCatalog, ApiStation, ApiTimelineEntry, ApiUser, DocumentKind,
  GeoPoint, MediaMeta, Offer, OfferAction, ServiceType, StandingAction, StationApplicationInput,
} from './apiTypes';

const me = () => getSession() ?? (() => { throw new Error('Please sign in again.'); })();

export interface RequestHelpInput {
  description: string;
  location: { lat: number; lon: number };
  address?: string;
  locationSource: 'manual' | 'gps';
  files: Blob[];
  /** Per file: camera or gallery, and EXIF capture time / GPS. */
  meta: (MediaMeta | undefined)[];
  deviceLocation?: GeoPoint;
  declarationAccepted: true;
  /** Demo scenarios: what the AI perception would extract from the evidence. */
  simulated?: { labels?: string[]; transcript?: string };
}

export const citizenApi = {
  async requestHelp(input: RequestHelpInput, onProgress?: (step: string) => void): Promise<string> {
    if (isLiveMode) {
      const s = me();
      const { incidentId } = await live.reportIncident({ ...input, reporter: { name: s.name, phone: s.phone } }, onProgress);
      return incidentId;
    }
    onProgress?.(input.files.length ? 'Uploading evidence…' : 'Sending request…');
    await new Promise(r => setTimeout(r, 600));
    return demoCitizen.createRequest(me(), {
      description: input.description, location: input.location, address: input.address, locationSource: input.locationSource,
      mediaKinds: input.files.map(f => (f.type.startsWith('image') ? 'image' : f.type.startsWith('video') ? 'video' : 'audio')),
      meta: input.meta, deviceLocation: input.deviceLocation, declarationAccepted: input.declarationAccepted,
      simulatedLabels: input.simulated?.labels, simulatedTranscript: input.simulated?.transcript,
    });
  },
  myRequests: async (): Promise<ApiCitizenRequest[]> => (isLiveMode ? live.listMyRequests() : demoCitizen.myRequests(me().userId)),
  requestStatus: async (id: string): Promise<ApiCitizenRequest | undefined> => (isLiveMode ? live.getRequestStatus(id) : demoCitizen.requestStatus(id)),
  async shareLocation(id: string, lat: number, lon: number, accuracy?: number) {
    if (isLiveMode) await live.updateMyLocation(id, lat, lon, accuracy);
    else demoCitizen.updateLocation(id, me().userId, lat, lon);
  },
  services: async (): Promise<ApiServicesCatalog> => (isLiveMode ? live.listServices() : demoCitizen.catalog()),
  profile: async (): Promise<ApiProfile> => (isLiveMode ? live.getMyProfile() : demoCitizen.profile(me())),
  sendPhoneCode: async (phone: string) => (isLiveMode ? live.sendMyPhoneCode(phone) : demoCitizen.sendPhoneCode(me(), phone)),
  verifyPhone: async (code: string): Promise<ApiProfile> => (isLiveMode ? live.verifyMyPhone(code) : demoCitizen.verifyPhone(me(), code)),
};

/** Machine-readable reason a request was refused: SUSPENDED, PHONE_NOT_VERIFIED or RATE_LIMITED. */
export function errorCode(e: unknown): string | undefined {
  const err = e as { code?: string; details?: { details?: { code?: string } } };
  return err?.code ?? err?.details?.details?.code;
}

/** Any signed-in account's own activity history. */
export const accountApi = {
  activity: async (cursor?: string): Promise<ApiActivityPage> => (isLiveMode ? live.getMyActivity(cursor) : demoActivity.mine(me().userId, cursor)),
};

export const stationApi = {
  me: async (): Promise<ApiStation | null> => (isLiveMode ? live.getMyStation() : demoStation.me(me().userId)),
  saveApplication: async (input: StationApplicationInput) => (isLiveMode ? live.saveStationApplication(input) : demoStation.saveApplication(me(), input)),
  uploadDocuments: async (files: { file: File; kind: DocumentKind }[]) =>
    (isLiveMode ? live.uploadStationDocuments(files) : demoStation.addDocuments(me().userId, files.map(f => ({ name: f.file.name, kind: f.kind })))),
  removeDocument: async (key: string) => demoStation.removeDocument(me().userId, key),
  sendPhoneOtp: async () => (isLiveMode ? live.sendStationPhoneOtp() : demoStation.sendPhoneOtp(me().userId)),
  verifyPhone: async (code: string) => (isLiveMode ? live.verifyStationPhone(code) : demoStation.verifyPhone(me().userId, code)),
  submit: async () => (isLiveMode ? live.submitStationApplication() : demoStation.submit(me().userId)),
  updateOperations: async (ops: { onDuty?: boolean; unitsAvailable?: number; unitsTotal?: number }) =>
    (isLiveMode ? live.updateStationOperations(ops) : demoStation.updateOperations(me().userId, ops)),
  offers: async (): Promise<Offer[]> => (isLiveMode ? live.listStationOffers() : demoStation.offers(me().userId)),
  async action(offerId: string, action: OfferAction, payload: { reason?: string; code?: string } = {}) {
    if (isLiveMode) await live.stationOfferAction(offerId, action, payload);
    else demoStation.action(me().userId, offerId, action, payload);
  },
};

export const adminApi = {
  overview: async (): Promise<ApiOverview> => (isLiveMode ? live.adminOverview() : demoAdmin.overview()),
  incidents: async (): Promise<ApiAdminIncident[]> => (isLiveMode ? live.adminIncidents('ALL') : demoAdmin.incidents()),
  incident: async (id: string): Promise<{ incident: ApiAdminIncident; timeline: ApiTimelineEntry[] } | null> =>
    (isLiveMode ? live.adminIncident(id) : demoAdmin.incident(id)),
  async assign(id: string, type: ServiceType, stationId: string) {
    if (isLiveMode) await live.adminAssign(id, type, stationId);
    else demoAdmin.assign(id, type, stationId);
  },
  async resolve(id: string, note?: string) {
    if (isLiveMode) await live.adminResolve(id, note);
    else demoAdmin.resolve(id, note);
  },
  stations: async (): Promise<ApiStation[]> => (isLiveMode ? live.adminStations() : demoAdmin.stations()),
  station: async (id: string) => (isLiveMode ? live.adminStation(id) : demoAdmin.station(id)),
  async review(id: string, action: 'approve' | 'reject' | 'suspend' | 'reinstate', note?: string) {
    if (isLiveMode) await live.adminReviewStation(id, action, note);
    else demoAdmin.review(id, action, note);
  },
  users: async (): Promise<ApiUser[]> => (isLiveMode ? live.adminUsers() : demoAdmin.users()),
  async userAction(user: ApiUser, action: 'disable' | 'enable' | 'delete') {
    if (isLiveMode) await live.adminUserAction(user.username, action);
    else demoAdmin.userAction(user.userId!, action);
  },
  activity: async (userId: string, cursor?: string): Promise<ApiActivityPage> =>
    (isLiveMode ? live.adminActivity(userId, cursor) : demoActivity.of(userId, cursor)),
  standing: async (userId: string, action: StandingAction, note?: string): Promise<ApiProfile> =>
    (isLiveMode ? live.adminCitizenStanding(userId, action, note) : demoAdmin.standing(userId, action, note)),
};
