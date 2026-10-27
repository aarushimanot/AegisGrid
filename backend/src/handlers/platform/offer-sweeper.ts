// Every minute: requests a station did not accept within the window move on to
// the next nearest station of the same service.

import { expireOffer } from "../../lib/dispatch";
import { log } from "../../lib/logger";
import { listExpired } from "../../lib/offers";

export const handler = async () => {
  const expired = await listExpired(new Date().toISOString());
  for (const offer of expired) {
    try {
      await expireOffer(offer);
    } catch (error) {
      log.error("Could not move expired offer", { offerId: offer.offerId, error });
    }
  }
  log.info("Offer sweep complete", { expired: expired.length });
  return { expired: expired.length };
};
