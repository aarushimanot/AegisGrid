// Step Functions: read a finished Amazon Transcribe job's output from S3.

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../../lib/aws";
import { config } from "../../lib/config";

interface TranscribeOutput {
  results?: { transcripts?: { transcript: string }[]; language_code?: string };
}

export const handler = async (input: { key: string; outputKey: string; languageCode?: string }) => {
  const obj = await s3.send(new GetObjectCommand({ Bucket: config.mediaBucket, Key: input.outputKey }));
  const body = JSON.parse(await obj.Body!.transformToString()) as TranscribeOutput;
  const text = (body.results?.transcripts ?? []).map((t) => t.transcript).join(" ").trim();
  return { key: input.key, text, languageCode: input.languageCode ?? body.results?.language_code };
};
