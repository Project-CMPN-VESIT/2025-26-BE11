// src/pipeline/decisionReasoning.ts

import { readJson, writeJson } from "../utils/fileUtils";
import { SEMANTIC_MAP_PATH } from "../config/constants";
import type {
  SemanticMap,
  DecisionReasoning,
  UserMediaRole,
} from "../types/semanticMap";
import { askDecisionEngine } from "../openai/askDecisionEngine";

function safeJsonParse<T>(raw: string, label: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`Failed to parse JSON output for ${label}.`);
    console.error("Raw LLM response:", raw);
    return undefined;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type FinalDecision =
  | "fetch_from_web"
  | "generate_with_model"
  | "hybrid_fetch_and_enhance";

type MediaUseStrategy =
  | "img2img"           // user image/video fed as conditioning input to FAL
  | "audio_reference"   // audio tags drive search/generation query
  | "style_transfer"    // style extracted → prompt-based generation
  | "context_only";     // file informed Stage 1 but is not passed to Stage 3b

interface EnrichedDecision extends DecisionReasoning {
  has_user_media?: boolean;
  media_use_strategy?: MediaUseStrategy;
  user_asset_path?: string;
}

// ─── Helper: resolve media strategy from role ─────────────────────────────────

function resolveMediaStrategy(
  role: UserMediaRole,
  modality: string
): MediaUseStrategy {
  switch (role) {
    case "transform":
      // image & video → img2img conditioning; audio → audio reference model
      return modality === "audio" ? "audio_reference" : "img2img";
    case "style_guide":
      return "style_transfer";
    case "reference":
    case "replace":
    default:
      return "context_only";
  }
}

// ─── Helper: build media context block for LLM prompt ────────────────────────

function buildMediaDecisionBlock(semanticMap: SemanticMap): string {
  const um = semanticMap.user_media;
  if (!um) return "";

  return `
---
The user also uploaded a ${um.modality} file. Stage 1 resolved its role as: "${um.role}".
${um.transformation_intent ? `Transformation intent: "${um.transformation_intent}"` : ""}

Apply these rules when choosing your decision:
  • "transform"   role → MUST choose "generate_with_model"
  • "style_guide" role → MUST choose "generate_with_model"
  • "reference"   role → use normal fetch vs generate logic, but note
                         the media tags should enrich the search query
  • "replace"     role → ignore the file; decide as if no media was provided
---
`.trim();
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runDecisionReasoning(
  attemptNumber = 1
): Promise<SemanticMap> {

  console.log("\n--- DECISION REASONING MODULE ---");

  const semanticMap =
    (await readJson<SemanticMap>(SEMANTIC_MAP_PATH)) ??
    ({} as SemanticMap);

  if (!semanticMap.user_prompt) {
    throw new Error(
      `Semantic map not found at ${SEMANTIC_MAP_PATH}. Please run prompt understanding first.`
    );
  }

  const previousResults = semanticMap.relevant_assets?.length ?? 0;
  const realism = semanticMap.realism_scoring?.realism_score ?? 0.5;
  const scarcity = semanticMap.market_availability_estimate ?? 0.5;
  const userMedia = semanticMap.user_media;

  // ─── Helper: stamp decision + media fields, save, return ─────────────────
  const commit = async (
    decision: FinalDecision,
    reasoning: string,
    confidence: number,
  ): Promise<SemanticMap> => {
    const enriched: EnrichedDecision = {
      reasoning_trace: reasoning,
      final_decision: decision,
      confidence,
    };

    if (userMedia?.provided) {
      const strategy = resolveMediaStrategy(userMedia.role, userMedia.modality);
      enriched.has_user_media = true;
      enriched.media_use_strategy = strategy;

      // Forward file path to Stage 3b only when it will actually be used
      if (strategy === "img2img" || strategy === "audio_reference") {
        enriched.user_asset_path = userMedia.file_path;
      }

      console.log(`[Stage 2] user_media detected — role: "${userMedia.role}", strategy: "${strategy}"`);
    }

    semanticMap.decision_reasoning = enriched;
    await writeJson(SEMANTIC_MAP_PATH, semanticMap);
    return semanticMap;
  };

  // =========================================================================
  // PRIORITY 0 — User media hard overrides (checked BEFORE everything else)
  // =========================================================================

  if (userMedia?.provided) {
    // "transform" and "style_guide" always require generation — no ambiguity
    if (userMedia.role === "transform") {
      console.log(`[Stage 2] User media role "transform" → forcing generate_with_model.`);
      return commit(
        "generate_with_model",
        `User uploaded a ${userMedia.modality} and requested a direct transformation: ` +
        `"${userMedia.transformation_intent ?? "modify media"}". Generation required.`,
        0.97,
      );
    }

    if (userMedia.role === "style_guide") {
      console.log(`[Stage 2] User media role "style_guide" → forcing generate_with_model.`);
      return commit(
        "generate_with_model",
        `User provided a ${userMedia.modality} as a style reference. ` +
        `Style-transfer generation required.`,
        0.95,
      );
    }

    // "replace" — treat file as context only, fall through to normal logic
    if (userMedia.role === "replace") {
      console.log(`[Stage 2] User media role "replace" → ignoring file, running normal logic.`);
    }

    // "reference" — fall through; normal logic runs but LLM gets media context
  }

  // =========================================================================
  // PRIORITY 1 — Hard overrides (no LLM)
  // =========================================================================

  // Retry override — only escalate to generation if scraping genuinely returned
  // nothing. If fetched_assets had content but the relevance filter rejected all
  // of it, fall through to normal routing so we retry the fetch (with the
  // refined prompt) rather than burning generation credits unnecessarily.
  const fetchedCount = semanticMap.fetched_assets?.length ?? 0;
  if (attemptNumber > 1 && previousResults === 0 && fetchedCount === 0) {
    console.log("Retry: scraper returned nothing → forcing generation.");
    return commit(
      "generate_with_model",
      "Previous fetch attempt returned zero scraped assets. Generating.",
      0.95,
    );
  }
  if (attemptNumber > 1 && previousResults === 0 && fetchedCount > 0) {
    // Scraper found things but relevance filter rejected them all.
    // Retry fetch with the refined (more descriptive) prompt — fall through.
    console.log(
      `Retry: scraper found ${fetchedCount} assets but relevance filter rejected all. ` +
      `Retrying fetch with refined prompt (falling through to normal routing).`
    );
  }

  // Scarcity override
  if (scarcity < 0.3) {
    console.log("Very rare content → generating.");
    return commit(
      "generate_with_model",
      "Market availability extremely low. Generating synthetic media.",
      0.9,
    );
  }

  // =========================================================================
  // PRIORITY 2 — High-confidence rule zone (no LLM)
  // =========================================================================

  // Real-world, everyday subjects that are abundant in stock libraries.
  // Lowered thresholds so prompts like "dog walking on road" are caught here
  // instead of leaking into the ambiguous LLM zone.
  if (realism >= 0.65 && scarcity >= 0.6) {
    console.log("High realism + good stock availability → fetch.");
    return commit(
      "fetch_from_web",
      `High realism (${realism.toFixed(2)}) and good market availability (${scarcity.toFixed(2)}). Fetching from web.`,
      0.88,
    );
  }

  // Realistic but niche/scarce → synthesise rather than waste API credits on
  // a hybrid run that will likely produce poor scrape results anyway.
  if (realism >= 0.65 && scarcity < 0.45) {
    console.log("Realistic but scarce content → generate.");
    return commit(
      "generate_with_model",
      `Realistic content (${realism.toFixed(2)}) but low market availability (${scarcity.toFixed(2)}). Generating.`,
      0.85,
    );
  }

  if (realism < 0.3) {
    console.log("Low realism (fantasy/abstract) → generate.");
    return commit(
      "generate_with_model",
      "Low realism indicates fantasy or abstract content. Generating.",
      0.85,
    );
  }

  // =========================================================================
  // PRIORITY 3 — Ambiguous zone → LLM
  // =========================================================================

  console.log("Ambiguous zone detected → calling LLM decision engine.");

  const mediaBlock = buildMediaDecisionBlock(semanticMap);

  const decisionPrompt = `
You are performing Decision Reasoning based on this semantic map:

${JSON.stringify(semanticMap, null, 2)}
${mediaBlock ? "\n" + mediaBlock : ""}

Consider:
- realism_score: how photorealistic / real-world is the subject
- abstractness_score: how conceptual or imaginary
- market_availability_estimate: how common this content is in free stock libraries
- attempt number
- previous results
${userMedia?.provided ? `- user_media.role is "${userMedia.role}" — follow the rules above` : ""}

Guidelines (apply in order):
1. If the subject is realistic (realism >= 0.5) AND commonly photographed (market_availability >= 0.5),
   STRONGLY prefer "fetch_from_web". Only choose "hybrid_fetch_and_enhance" if you are very confident
   that scraped results will be insufficient AND generation will meaningfully improve quality.
2. Reserve "hybrid_fetch_and_enhance" ONLY for specialised creative briefs that genuinely need both
   real footage AND AI enhancement (e.g. "product photo on Mars background").
3. Use "generate_with_model" only when the content is rare, fantastical, abstract, or requires compositing.

IMPORTANT: "hybrid_fetch_and_enhance" consumes twice the API credits. Prefer simpler strategies.

Choose ONE:
- "fetch_from_web"
- "generate_with_model"
- "hybrid_fetch_and_enhance"

Return valid JSON:
{
  "reasoning_trace": "",
  "final_decision": "",
  "confidence": 0.0
}
`.trim();

  const raw = await askDecisionEngine(decisionPrompt);

  const decisionData =
    safeJsonParse<DecisionReasoning>(raw, "decision_reasoning") ?? {
      reasoning_trace: "Fallback to fetch due to parse failure.",
      final_decision: "fetch_from_web",   // safe default — avoids wasting generation credits
      confidence: 0.6,
    };

  // Use commit() so media fields are always stamped consistently
  const decision = (decisionData.final_decision as FinalDecision) ?? "hybrid_fetch_and_enhance";
  return commit(
    decision,
    decisionData.reasoning_trace ?? "",
    decisionData.confidence ?? 0.6,
  );
}