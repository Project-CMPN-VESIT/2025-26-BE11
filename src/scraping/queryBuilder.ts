import { openaiClient } from "../openai/client";
import { MAX_QUERIES } from "../config/constants";
import type { SemanticMap, MediaType } from "../types/semanticMap";

interface QueryResult {
  queries: string[];
}

/* -------------------------------------------------- */
/* 🎯 STOCK SEARCH GUIDANCE                           */
/* -------------------------------------------------- */

function modalityGuidance(modality: MediaType): string {
  if (modality === "image") {
    return `
Use photographic stock tagging language.
Include subject + environment + lighting + context when possible.
Examples: "businessman office desk", "woman portrait golden hour".
`;
  }

  if (modality === "video") {
    return `
Use cinematic stock search phrases.
Combine subject + action + environment.
Keep phrases 2–5 words.
Examples: "waves crashing rocky shore", "woman jogging park morning".
`;
  }

  return `
Use common sound effect search phrases.  Add emotional or human-SFX keywords when appropriate (crying, sobbing, laughter, footsteps, breathing, etc.).
Mention whether it should be a sound effect or ambient recording.
Examples: "rain ambience", "keyboard typing", "crowd cheering stadium", "male sobbing sound", "woman crying softly".
`;
}

/* -------------------------------------------------- */
/* 🧠 SYNONYM EXPANSION                              */
/* -------------------------------------------------- */

const synonymMap: Record<string, string[]> = {
  car: ["car", "vehicle", "automobile"],
  office: ["office", "workplace", "corporate"],
  city: ["city", "urban", "downtown"],
  beach: ["beach", "shore", "coast"],
  forest: ["forest", "woodland", "nature"],
  dog: ["dog", "canine", "pet"],
  man: ["man", "male", "person"],
  woman: ["woman", "female", "person"],
};

function expandTerms(term: string): string[] {
  const key = term.toLowerCase();
  return synonymMap[key] ?? [term];
}

/* -------------------------------------------------- */
/* 🧠 QUERY PROMPT BUILDER                           */
/* -------------------------------------------------- */

function buildQueryPrompt(
  semanticMap: SemanticMap,
  modality: MediaType,
  n: number,
  attemptNumber = 1
): string {
  const scarcity = semanticMap.market_availability_estimate ?? 0.5;

  const retryInstruction =
    attemptNumber > 1
      ? `
The previous search returned poor results.
Generate broader variations and alternative environments
to improve search coverage.
`
      : "";

  return `
You generate HIGH-RECALL stock search phrases.

Think like a stock photographer tagging media.

Input semantic_map:
${JSON.stringify(semanticMap, null, 2)}

Modality: ${modality}

${modalityGuidance(modality)}

RULES:
• Use subject + action + environment when possible
• Use common stock keywords (business, lifestyle, urban, nature, cinematic)
• Avoid poetic or metaphorical language
• Avoid abstract wording
• Avoid full sentences
• Optimize for real stock search retrieval

If the concept is rare or unrealistic,
transform it into visually plausible search phrases.

Generate variation across:
• environments
• synonyms
• professional contexts
• lighting & mood

${retryInstruction}

Return up to ${n} phrases (2–6 words).

Return EXACTLY:
{"queries": ["...", "..."]}
`.trim();
}

/* -------------------------------------------------- */
/* 🧠 QUERY CLEANING & QUALITY CONTROL                */
/* -------------------------------------------------- */

function cleanQueries(queries: string[]): string[] {
  const seen = new Set<string>();

  return queries
    .map((q) => q.toLowerCase().trim())
    .filter((q) => q.length > 3)
    .filter((q) => !q.includes(","))
    .filter((q) => {
      if (seen.has(q)) return false;
      seen.add(q);
      return true;
    })
    .slice(0, MAX_QUERIES);
}

/* -------------------------------------------------- */
/* 🧠 HEURISTIC FALLBACK                              */
/* -------------------------------------------------- */

function heuristicFallback(
  semanticMap: SemanticMap,
  modality: MediaType
): QueryResult {
  const intent = semanticMap.intent_extraction ?? {};
  const subject = intent.primary_subject ?? "";
  const context = intent.context_scene ?? "";

  const expanded = expandTerms(subject);

  let seeds: string[] = [];

  if (modality === "image") {
    seeds = expanded.map(
      (term) => `${term} ${context} portrait`.trim()
    );
  } else if (modality === "video") {
    seeds = expanded.map(
      (term) => `${term} ${context} walking`.trim()
    );
  } else {
    seeds = expanded.map((term) => `${term} ambience`.trim());
  }

  // enhance audio heuristics by appending common SFX descriptors
  if (modality === "audio") {
    seeds = seeds.flatMap(s => [
      `${s} sound`,
      `${s} sound effect`,
      `${s} ambience`,
      `${s} recording`
    ]);
  }
  return {
    queries: cleanQueries(seeds),
  };
}

/* -------------------------------------------------- */
/* 🚀 MAIN QUERY BUILDER                             */
/* -------------------------------------------------- */

export async function buildSearchQueries(
  semanticMap: SemanticMap,
  modality: MediaType,
  attemptNumber = 1
): Promise<QueryResult> {
  const prompt = buildQueryPrompt(
    semanticMap,
    modality,
    MAX_QUERIES,
    attemptNumber
  );

  try {
    const resp = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" }, // improves parsing reliability
      messages: [
        {
          role: "system",
          content:
            "You generate stock-search phrases and MUST respond in valid JSON format.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 300,
    });

    const txt = resp.choices[0]?.message?.content?.trim() ?? "";

    try {
      const parsed = JSON.parse(txt) as QueryResult;
      return { queries: cleanQueries(parsed.queries) };
    } catch {
      console.warn("[queryBuilder] JSON parse failed. Attempting recovery.");

      const match = txt.match(
        /(\{[\s\S]*"queries"\s*:\s*\[[\s\S]*?\][\s\S]*\})/
      );

      if (match) {
        const parsed = JSON.parse(match[1]) as QueryResult;
        return { queries: cleanQueries(parsed.queries) };
      }

      return heuristicFallback(semanticMap, modality);
    }
  } catch (err) {
    console.error("[queryBuilder] OpenAI error:", err);
    return heuristicFallback(semanticMap, modality);
  }
}