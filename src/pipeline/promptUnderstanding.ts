// src/pipeline/promptUnderstanding.ts

import path from "path";
import { askPromptEngine } from "../openai/askPromptEngine";
import { SEMANTIC_MAP_PATH } from "../config/constants";
import { writeJson } from "../utils/fileUtils";
import {
  SemanticMap,
  IntentExtraction,
  RealismScoring,
  MediaContext,
  UserMedia,
  UserMediaRole,
} from "../types/semanticMap";
import type { MediaType } from "../types/semanticMap";

function safeJsonParse<T>(raw: string, label: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`Failed to parse JSON output for ${label}.`);
    console.error("Raw LLM response:", raw);
    return undefined;
  }
}

// ─── Media context block injected into the prompt when a file is provided ────

function buildMediaContextBlock(mediaContext: MediaContext): string {
  const lines: string[] = [
    "",
    "---",
    `The user has also uploaded a ${mediaContext.modality} file alongside their prompt.`,
    `Here is what the file contains:`,
    "",
    `  Description : ${mediaContext.description}`,
    `  Tags        : ${mediaContext.tags.join(", ")}`,
  ];

  if (mediaContext.transcription) {
    lines.push(`  Transcription: "${mediaContext.transcription}"`);
  }
  if (mediaContext.duration) {
    lines.push(`  Duration    : ${mediaContext.duration.toFixed(1)}s`);
  }
  if (mediaContext.resolution) {
    lines.push(`  Resolution  : ${mediaContext.resolution.w}×${mediaContext.resolution.h}`);
  }

  lines.push(
    "",
    "Using BOTH the file description above AND the user's text prompt, also determine:",
    "",
    '4) User Media Role — how should this file be used? Choose exactly one:',
    '   - "transform"   : the user wants to directly modify the uploaded file',
    '                     (e.g. "make this photo look like it\'s raining")',
    '   - "reference"   : the user wants something similar to / inspired by the file',
    '                     (e.g. "find me more audio like this")',
    '   - "style_guide" : extract the aesthetic and apply it to entirely new content',
    '                     (e.g. "use this colour palette for a new image")',
    '   - "replace"     : the file is background context only; output replaces it',
    '                     (e.g. "here\'s my old logo, make a new modern one")',
    "",
    '   Set "transformation_intent" to a plain-English description of the change',
    '   ONLY when role is "transform" (e.g. "change weather from sunny to rainy").',
    '   For all other roles, omit "transformation_intent" entirely.',
    "",
    "Add a top-level \"user_media\" key to your JSON output:",
    "",
    '{',
    '  "user_media": {',
    '    "role": "<transform|reference|style_guide|replace>",',
    '    "transformation_intent": "<string or omit>"',
    '  }',
    '}',
    "---",
  );

  return lines.join("\n");
}

// ─── Schema additions when media is present ───────────────────────────────────

const MEDIA_SCHEMA_ADDITION = `
  "user_media": {
    "role": "",
    "transformation_intent": ""
  },`;

// ─── Main exported function ───────────────────────────────────────────────────

export async function runPromptUnderstanding(
  userPrompt: string,
  requestedCount?: number,
  requestedModality?: MediaType,
  mediaUrl?: string,
  mediaType?: "image" | "video" | "audio",
  mediaContext?: MediaContext,
): Promise<SemanticMap> {
  const startTime = Date.now();

  console.log("\n🧠 --- PROMPT UNDERSTANDING MODULE ---");
  console.log("Input Prompt:", userPrompt);
  if (mediaContext) {
    console.log(`Media Context: [${mediaContext.modality}] ${mediaContext.description.slice(0, 80)}…`);
  }
  console.log("-----------------------------------");

  // Build the media context injection and schema extension conditionally
  const mediaBlock = mediaContext ? buildMediaContextBlock(mediaContext) : "";
  const mediaSchema = mediaContext ? MEDIA_SCHEMA_ADDITION : "";

  const unifiedPrompt = `
Perform structured Prompt Understanding.

User Prompt:
"${userPrompt}"
${mediaBlock}

Internally reason step-by-step. Do NOT reveal reasoning.
Return ONLY valid JSON.

Tasks:

1) Intent Extraction
   - modality (image | video | audio)
   - domain
   - primary_subject
   - context_scene
   - style_adjectives (array)

2) Realism Scoring
   - realism_score (0–1)
   - abstractness_score (0–1)
   - short rationale

3) Market Availability
   - Estimate commonness in free stock libraries (0–1)
${mediaContext ? "\n4) User Media Role — see instructions above\n" : ""}
Schema:

{
  "intent_extraction": {
    "modality": "",
    "domain": "",
    "primary_subject": "",
    "context_scene": "",
    "style_adjectives": []
  },
  "realism_scoring": {
    "realism_score": 0.0,
    "abstractness_score": 0.0,
    "rationale": ""
  },
  "market_availability_estimate": 0.0${mediaSchema}
}
`.trim();

  const raw = await askPromptEngine(unifiedPrompt, mediaUrl, mediaType);

  console.log("\n--- RAW LLM RESPONSE ---");
  console.log(raw);
  console.log("------------------------\n");

  const parsed = safeJsonParse<{
    intent_extraction: IntentExtraction;
    realism_scoring: RealismScoring;
    market_availability_estimate: number;
    user_media?: { role: UserMediaRole; transformation_intent?: string };
  }>(raw, "prompt_understanding");

  // ─── Build user_media field if a file was provided ────────────────────────
  let userMedia: UserMedia | undefined;

  if (mediaContext) {
    const llmMedia = parsed?.user_media;
    const role: UserMediaRole = llmMedia?.role ?? "reference"; // safe default

    userMedia = {
      provided: true,
      modality: mediaContext.modality,
      description: mediaContext.description,
      tags: mediaContext.tags,
      role,
      transformation_intent: role === "transform"
        ? llmMedia?.transformation_intent
        : undefined,
      file_path: mediaContext.filePath,
    };

    console.log(`[Stage 1] user_media.role resolved to: "${role}"`);
    if (userMedia.transformation_intent) {
      console.log(`[Stage 1] transformation_intent: "${userMedia.transformation_intent}"`);
    }
  }

  // ─── Assemble SemanticMap ─────────────────────────────────────────────────
  // Strip the [user instruction: ...] bracket that index.ts appends for
  // Stage 1 context — it should not be stored in the semantic map or forwarded
  // to the relevance matcher / generation prompt builder.
  const cleanUserPrompt = userPrompt.replace(/\s*\[user instruction:[^\]]*\]/g, "").trim();

  const semanticMap: SemanticMap = {
    user_prompt: cleanUserPrompt,
    requested_asset_count: requestedCount,
    requested_modality: requestedModality,
    intent_extraction: parsed?.intent_extraction ?? {},
    realism_scoring: parsed?.realism_scoring ?? {},
    market_availability_estimate: parsed?.market_availability_estimate ?? 0.5,
    ...(userMedia && { user_media: userMedia }),   // only set when media was provided
  };

  // ─── Metrics ──────────────────────────────────────────────────────────────
  const latency = Date.now() - startTime;

  let filledFields = 0;
  const totalFields = 5;
  const intent = semanticMap.intent_extraction || {};
  if (intent.modality) filledFields++;
  if (intent.domain) filledFields++;
  if (intent.primary_subject) filledFields++;
  if (intent.context_scene) filledFields++;
  if (intent.style_adjectives && intent.style_adjectives.length > 0) filledFields++;

  const completeness = filledFields / totalFields;

  semanticMap.evaluation_metrics = {
    timestamp: new Date().toISOString(),
    total_latency_ms: 0,   // Updated at end by index.ts
    system_health_score: 0,
    stage1: {
      latency_ms: latency,
      completeness_score: completeness,
      modality_confidence: 0.9,
    },
  };

  await writeJson(SEMANTIC_MAP_PATH, semanticMap);

  console.log(`Semantic map saved to: ${path.relative(process.cwd(), SEMANTIC_MAP_PATH)}`);
  console.log("Parsed Semantic Map:");
  console.log(JSON.stringify(semanticMap, null, 2));
  console.log("Prompt understanding stage completed.\n");

  return semanticMap;
}