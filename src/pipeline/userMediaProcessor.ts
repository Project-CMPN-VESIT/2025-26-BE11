import fs from "fs";
import path from "path";
import { sha256Bytes } from "../utils/hashing";
import { writeJson } from "../utils/fileUtils";
import { SEMANTIC_MAP_PATH } from "../config/constants";
import type { SemanticMap, MediaType } from "../types/semanticMap";
import { runPromptUnderstanding } from "./promptUnderstanding";

const fsp = fs.promises;

function inferModalityFromExt(filePath: string): MediaType {
  const ext = path.extname(filePath).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff"].includes(ext)) return "image";
  if ([".mp4", ".mov", ".webm", ".mkv", ".avi"].includes(ext)) return "video";
  return "audio";
}

export async function processUserMedia(
  filePath: string,
  userPrompt: string
): Promise<SemanticMap> {
  // Read file
  const content = await fsp.readFile(filePath);
  const hash = sha256Bytes(content);
  const stats = await fsp.stat(filePath);

  const modality = inferModalityFromExt(filePath);

  // Run text prompt understanding (will persist a semantic map)
  const semanticMap = await runPromptUnderstanding(userPrompt, undefined, modality);

  // Attach user provided asset metadata
  const userAsset = {
    filename: path.basename(filePath),
    absolute_path: path.resolve(filePath),
    sha256: hash,
    file_size_bytes: stats.size,
    file_size_mb: +(stats.size / (1024 * 1024)).toFixed(3),
    inferred_modality: modality,
    uploaded_at: new Date().toISOString(),
  };

  semanticMap.user_provided_asset = userAsset;

  // Heuristic: detect modification intent from prompt (verbs + contextual hints)
  const lower = userPrompt.toLowerCase();

  const modKeywords = ["edit", "modify", "enhance", "retouch", "use this", "replace", "extend", "crop", "upscale", "improve", "convert", "change the", "make it", "turn into"];
  const weatherKeywords = ["rain", "raining", "snow", "snowing", "sunny", "storm", "cloudy", "clouds", "fog"];

  // If the user explicitly asks to modify, or asks to change weather while keeping the scenery, treat as modify
  let wantsModify = modKeywords.some((k) => lower.includes(k));
  const mentionsWeather = weatherKeywords.some((w) => lower.includes(w));
  const mentionsKeep = lower.includes("keep") || lower.includes("same") || lower.includes("scenery") || lower.includes("scene");

  if (!wantsModify && mentionsWeather && mentionsKeep) {
    wantsModify = true;
  }

  if (!semanticMap.intent_extraction) semanticMap.intent_extraction = {};
  semanticMap.intent_extraction.requested_action = wantsModify ? "modify_existing_asset" : "use_as_reference_or_generate";

  await writeJson(SEMANTIC_MAP_PATH, semanticMap);

  return semanticMap;
}
