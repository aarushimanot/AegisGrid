// What a station's staff see: their own station (without verification secrets)
// and their offers (never the citizen's one-time codes).

import type { Offer, Station } from "./types";

export function toStationView(s: Station) {
  const { verification, ...rest } = s;
  const { phoneOtp, ...v } = verification;
  void phoneOtp;
  return {
    ...rest,
    verification: v,
    avgResponseMinutes: s.stats.completed ? Math.round((s.stats.totalResponseMinutes / s.stats.completed) * 10) / 10 : null,
  };
}

export const toOfferView = (o: Offer) => o;
