// Step Functions Map iteration: label one photo with Amazon Rekognition, and
// read its EXIF capture time and GPS (used to flag old or downloaded photos).

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { DetectLabelsCommand } from "@aws-sdk/client-rekognition";
import exifr from "exifr";
import { rekognition, s3 } from "../../lib/aws";
import { config } from "../../lib/config";
import { log } from "../../lib/logger";
import type { ImageFinding } from "../../lib/types";

async function readExif(key: string): Promise<ImageFinding["exif"]> {
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: config.mediaBucket, Key: key }));
    const bytes = await obj.Body!.transformToByteArray();
    const tags = (await exifr.parse(Buffer.from(bytes), { gps: true, pick: ["DateTimeOriginal", "CreateDate", "latitude", "longitude"] })) as
      | { DateTimeOriginal?: Date; CreateDate?: Date; latitude?: number; longitude?: number }
      | undefined;
    if (!tags) return undefined;
    const taken = tags.DateTimeOriginal ?? tags.CreateDate;
    return {
      capturedAt: taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.toISOString() : undefined,
      location: typeof tags.latitude === "number" && typeof tags.longitude === "number" ? { lat: tags.latitude, lon: tags.longitude } : undefined,
    };
  } catch (error) {
    log.warn("Could not read EXIF", { key, error });
    return undefined;
  }
}

export const handler = async (input: { key: string }): Promise<ImageFinding> => {
  const [res, exif] = await Promise.all([
    rekognition.send(new DetectLabelsCommand({ Image: { S3Object: { Bucket: config.mediaBucket, Name: input.key } }, MaxLabels: 25, MinConfidence: 70 })),
    readExif(input.key),
  ]);
  return {
    key: input.key,
    labels: (res.Labels ?? []).map((l) => ({ name: l.Name ?? "", confidence: Math.round(l.Confidence ?? 0) })),
    exif,
  };
};
