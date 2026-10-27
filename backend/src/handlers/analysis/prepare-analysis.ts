// Step Functions task 1: load the incident and fan its media out into the
// image branch (Rekognition) and the audio branch (Transcribe).

import { config } from "../../lib/config";
import { mustGetIncident } from "../../lib/incidents";
import { log } from "../../lib/logger";

export interface PrepareOutput {
  incidentId: string;
  images: { key: string }[];
  audio: { key: string; jobName: string; mediaUri: string; mediaFormat: string; outputKey: string }[];
}

export const handler = async (input: { incidentId: string }): Promise<PrepareOutput> => {
  const incident = await mustGetIncident(input.incidentId);
  log.with({ incidentId: incident.incidentId });

  const images = incident.media.filter((m) => m.kind === "image").map((m) => ({ key: m.key }));
  // Transcribe accepts video containers (mp4/webm) directly and transcribes their audio track.
  const audio = incident.media
    .filter((m) => m.kind === "audio" || m.kind === "video")
    .map((m, i) => {
      const jobName = `aegis-${incident.incidentId}-${i}`;
      return {
        key: m.key,
        jobName,
        mediaUri: `s3://${config.mediaBucket}/${m.key}`,
        mediaFormat: m.key.split(".").pop()!,
        outputKey: `transcripts/${incident.incidentId}/${jobName}.json`,
      };
    });

  log.info("Analysis prepared", { images: images.length, audio: audio.length });
  return { incidentId: incident.incidentId, images, audio };
};
