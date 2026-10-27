// Step Functions task: merge the citizen's text with voice transcripts,
// translate to English with Amazon Translate, extract entities, key phrases and
// sentiment with Amazon Comprehend, and save all analysis to the incident.

import { DetectDominantLanguageCommand, DetectEntitiesCommand, DetectKeyPhrasesCommand, DetectSentimentCommand } from "@aws-sdk/client-comprehend";
import { TranslateTextCommand } from "@aws-sdk/client-translate";
import { comprehend, translate } from "../../lib/aws";
import { mustGetIncident, saveAnalysis } from "../../lib/incidents";
import { log } from "../../lib/logger";
import type { ImageFinding, TextAnalysis } from "../../lib/types";

interface Input {
  incidentId: string;
  signals: { images: (ImageFinding | null)[]; transcripts: ({ key: string; text: string; languageCode?: string } | null)[] };
}

/** Comprehend synchronous APIs accept up to 5,000 bytes of UTF-8 (Translate: 10,000). */
function truncateBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  return buf.length <= maxBytes ? text : buf.subarray(0, maxBytes).toString("utf8").replace(/�$/, "");
}

export const handler = async (input: Input): Promise<{ incidentId: string }> => {
  const incident = await mustGetIncident(input.incidentId);
  log.with({ incidentId: incident.incidentId });

  const images = (input.signals?.images ?? []).filter((x): x is ImageFinding => !!x?.labels);
  const transcripts = (input.signals?.transcripts ?? []).filter((x): x is NonNullable<typeof x> => !!x?.text);
  const combined = [incident.description, ...transcripts.map((t) => t.text)].filter(Boolean).join("\n").trim();

  let text: TextAnalysis | undefined;
  if (combined) {
    let language = incident.language?.split("-")[0] ?? transcripts[0]?.languageCode?.split("-")[0];
    if (!language) {
      const dl = await comprehend.send(new DetectDominantLanguageCommand({ Text: truncateBytes(combined, 5000) }));
      language = dl.Languages?.sort((a, b) => (b.Score ?? 0) - (a.Score ?? 0))[0]?.LanguageCode ?? "en";
    }

    let english = combined;
    if (language !== "en") {
      const tr = await translate.send(
        new TranslateTextCommand({ Text: truncateBytes(combined, 10_000), SourceLanguageCode: "auto", TargetLanguageCode: "en" }),
      );
      english = tr.TranslatedText ?? combined;
      log.info("Report translated", { from: tr.SourceLanguageCode ?? language });
    }

    const sample = truncateBytes(english, 5000);
    const [entities, phrases, sentiment] = await Promise.all([
      comprehend.send(new DetectEntitiesCommand({ Text: sample, LanguageCode: "en" })),
      comprehend.send(new DetectKeyPhrasesCommand({ Text: sample, LanguageCode: "en" })),
      comprehend.send(new DetectSentimentCommand({ Text: sample, LanguageCode: "en" })),
    ]);

    text = {
      originalLanguage: language,
      translatedText: english,
      sentiment: sentiment.Sentiment,
      entities: (entities.Entities ?? []).filter((e) => (e.Score ?? 0) > 0.6).map((e) => ({ type: e.Type ?? "OTHER", text: e.Text ?? "" })),
      keyPhrases: (phrases.KeyPhrases ?? []).filter((p) => (p.Score ?? 0) > 0.7).map((p) => p.Text ?? "").slice(0, 20),
    };
  }

  await saveAnalysis(incident.incidentId, { text, images, transcripts });
  log.info("Text analysis saved", { hasText: !!text, images: images.length, transcripts: transcripts.length });
  return { incidentId: incident.incidentId };
};
