import fs from "fs";
import path from "path";
import sharp from "sharp";
import OpenAI from "openai";
import util from "util";
import { exec } from "child_process";
import ffmpeg from "ffmpeg-static";
import { readJson, writeJson, ensureDir } from "../utils/fileUtils";
import { SEMANTIC_MAP_PATH, DEST_DIR } from "../config/constants";
import type { SemanticMap, FetchedAsset } from "../types/semanticMap";

const execAsync = util.promisify(exec);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const REL_IMG = path.join(DEST_DIR, "relevant_assets", "images");
const REL_VID = path.join(DEST_DIR, "relevant_assets", "videos");
const REL_AUD = path.join(DEST_DIR, "relevant_assets", "audio");
const BATCH_SIZE = 8;
const MIN_SCORE = 0.45; // Lowered from 0.55 — natural/wildlife scenes are harder to score at 0.55 with vision models

/* ------------------------------------------------ */
/* Convert & validate image                         */
/* ------------------------------------------------ */

async function processImageForAPI(filePath: string): Promise<string | null> {
  try {
    const inputBuffer = fs.readFileSync(filePath);
    const metadata = await sharp(inputBuffer).metadata();
    const supported = ["jpeg", "jpg", "png", "gif", "webp"];
    let finalBuffer: Buffer;

    if (!metadata.format || !supported.includes(metadata.format)) {
      console.log(`🔄 Converting ${path.basename(filePath)} → jpeg`);
      finalBuffer = Buffer.from(await sharp(inputBuffer).jpeg().toBuffer());
    } else {
      finalBuffer = Buffer.from(inputBuffer);
    }

    const format = metadata.format === "jpg" ? "jpeg" : metadata.format || "jpeg";
    return `data:image/${format};base64,${finalBuffer.toString("base64")}`;
  } catch (err) {
    console.error(`❌ Image processing failed: ${path.basename(filePath)}`);
    return null;
  }
}

/* ------------------------------------------------ */
/* Extract intent priorities from prompt            */
/* ------------------------------------------------ */

async function extractIntent(prompt: string) {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
Extract structured intent from the user prompt.

Return JSON:

{
  "primary_subject": "",
  "primary_action": "",
  "supporting_objects": [],
  "relationships": [],
  "conflicting_actions_to_reject": []
}

Rules:
- primary_action = main verb/action
- supporting_objects = secondary items
- relationships = spatial words (beside, on table, next to)
- conflicting actions = actions that contradict the main action
`
      },
      { role: "user", content: prompt }
    ]
  });

  return JSON.parse(resp.choices[0].message.content || "{}");
}

/* ------------------------------------------------ */
/* Audio file validation via magic bytes            */
/* Catches corrupt/truncated files before Whisper   */
/* ------------------------------------------------ */

async function isValidAudioFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.promises.stat(filePath);

    // Less than 5KB is almost certainly a corrupt or empty download
    if (stats.size < 5120) {
      console.warn(`[audio] Skipping ${path.basename(filePath)} — too small (${stats.size} bytes)`);
      return false;
    }

    // Read first 12 bytes and check magic header
    const fd = await fs.promises.open(filePath, "r");
    const header = Buffer.alloc(12);
    await fd.read(header, 0, 12, 0);
    await fd.close();

    const hex = header.toString("hex");

    const isMP3 = hex.startsWith("494433") ||  // ID3v2 tag
      hex.startsWith("fffb") ||  // MPEG sync
      hex.startsWith("fff3") ||
      hex.startsWith("fff2");
    const isWAV = hex.startsWith("52494646");   // RIFF
    const isOGG = hex.startsWith("4f676753");   // OggS
    const isFLAC = hex.startsWith("664c6143");   // fLaC
    const isM4A = header.slice(4, 8).toString("ascii") === "ftyp";

    if (!isMP3 && !isWAV && !isOGG && !isFLAC && !isM4A) {
      console.warn(`[audio] Skipping ${path.basename(filePath)} — bad header (${hex.slice(0, 16)})`);
      return false;
    }

    return true;
  } catch (err) {
    console.warn(`[audio] Validation error for ${path.basename(filePath)}: ${err}`);
    return false;
  }
}

/* ------------------------------------------------ */
/* Metadata-based fallback scorer (no Whisper)      */
/* Used when transcription fails or file is invalid */
/* ------------------------------------------------ */

function scoreAudioByMetadata(asset: FetchedAsset, intent: any): number {
  const subject = (intent.primary_subject || "").toLowerCase();
  const objects = (intent.supporting_objects || []).map((s: string) => s.toLowerCase());
  const relationships = (intent.relationships || []).map((s: string) => s.toLowerCase());

  // Tokenize all phrases into individual words — "soft background piano music"
  // becomes ["soft", "background", "piano", "music"] so each word can independently
  // match against the filename, alt text, or query string.
  const stopWords = new Set(["a", "an", "the", "for", "and", "or", "of", "to", "in", "is", "it"]);
  const tokenize = (s: string) => s.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));

  const allPhrases = [subject, ...objects, ...relationships].filter(Boolean);
  const tokens = [...new Set(allPhrases.flatMap(tokenize))];

  // No tokens to match — neutral pass so file is not wrongly rejected
  if (tokens.length === 0) return 0.5;

  const searchable = [
    path.basename(asset.filename),
    asset.alt ?? "",
    asset.query_used ?? "",
    asset.source ?? "",
  ].join(" ").toLowerCase();

  const matches = tokens.filter(t => searchable.includes(t)).length;

  // query_used is the strongest signal — if the query matches well, boost score
  const queryText = (asset.query_used ?? "").toLowerCase();
  const queryTokens = tokenize(queryText);
  const intentTokens = tokenize(allPhrases.join(" "));
  const queryOverlap = intentTokens.filter(t => queryTokens.includes(t)).length;
  const queryBoost = intentTokens.length > 0 ? (queryOverlap / intentTokens.length) * 0.4 : 0;

  const baseScore = matches / tokens.length;
  const score = Math.min(1.0, baseScore + queryBoost);

  console.log(
    `[audio-meta] ${path.basename(asset.filename)} — ` +
    `tokens matched ${matches}/${tokens.length}, query boost +${queryBoost.toFixed(2)} → score ${score.toFixed(2)}`
  );

  return score;
}

/* ------------------------------------------------ */
/* MAIN MATCHER                                     */
/* ------------------------------------------------ */

export async function runRelevanceMatching(): Promise<void> {
  const startTime = Date.now();
  console.log("==================================================");
  console.log("🎯 INTENT-AWARE RELEVANCE MATCHING");
  console.log("==================================================");

  const semanticMap = await readJson<SemanticMap>(SEMANTIC_MAP_PATH);
  console.log("[relevance] fetched_assets count:", semanticMap?.fetched_assets?.length ?? "undefined");
  if (!semanticMap?.fetched_assets?.length) return;

  // ── img2img / style_transfer bypass ──────────────────────────────────────
  // For these strategies the assets are generated specifically for the user's
  // request — scoring them against a text prompt with GPT-4o vision produces
  // unreliable results. Auto-accept all and skip scoring entirely.
  const mediaStrategy = (semanticMap.decision_reasoning as any)?.media_use_strategy;
  if (mediaStrategy === "img2img" || mediaStrategy === "style_transfer") {
    console.log(`[relevance] strategy="${mediaStrategy}" — auto-accepting all generated assets.`);

    const allGenerated = semanticMap.fetched_assets;
    for (const asset of allGenerated) {
      const targetDir = asset.type === "image" ? REL_IMG
        : asset.type === "video" ? REL_VID
          : REL_AUD;
      await ensureDir(targetDir);
      const dest = path.join(targetDir, path.basename(asset.filename));
      await fs.promises.copyFile(asset.filename, dest);
      console.log(`✅ Auto-accepted: ${path.basename(asset.filename)}`);
    }

    semanticMap.relevant_assets = allGenerated.map(a => ({
      ...a,
      filename: path.join(
        a.type === "image" ? REL_IMG : a.type === "video" ? REL_VID : REL_AUD,
        path.basename(a.filename)
      ),
    }));

    await writeJson(SEMANTIC_MAP_PATH, semanticMap);
    console.log(`\n✨ Finished. Auto-accepted: ${allGenerated.length}`);
    return;
  }

  // ── Normal scoring path ───────────────────────────────────────────────────
  const prompt = semanticMap.user_prompt;
  const intent = await extractIntent(prompt);
  console.log("🧠 Intent Extracted:", intent);

  const mediaToScore = semanticMap.fetched_assets.filter(a => a.type === "image" || a.type === "video");
  const audioAssets = semanticMap.fetched_assets.filter(a => a.type === "audio");
  const finalRelevantAssets: FetchedAsset[] = [];
  const scoredAssets: { asset: FetchedAsset; score: number }[] = [];

  // ── Audio scoring ─────────────────────────────────────────────────────────
  if (mediaToScore.length === 0 && audioAssets.length > 0) {
    console.log(`Audio-only run — scoring ${audioAssets.length} audio assets with GPT.`);

    for (const a of audioAssets) {
      // Build a rich metadata context string for GPT to evaluate
      const metaContext = [
        `Filename: ${path.basename(a.filename)}`,
        a.alt ? `Title/Alt: ${a.alt}` : null,
        a.query_used ? `Search query used: ${a.query_used}` : null,
        a.source ? `Source: ${a.source}` : null,
      ].filter(Boolean).join("\n");

      let score = 0;

      try {
        const resp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `You are an audio relevance evaluator.
Given metadata about an audio file and the user's intent, score how likely this audio file matches what the user wants on a scale of 0.0 to 1.0.

Rules:
- Score 0.8–1.0 if the metadata strongly suggests a match (title, tags, query align with intent)
- Score 0.5–0.8 if there is partial alignment
- Score 0.2–0.5 if it is unclear but possible
- Score 0.0–0.2 if the metadata clearly does not match

Return JSON: { "score": 0.0, "reason": "..." }`
            },
            {
              role: "user",
              content: `USER INTENT:
Primary subject: ${intent.primary_subject}
Supporting objects: ${(intent.supporting_objects || []).join(", ")}
Relationships: ${(intent.relationships || []).join(", ")}

AUDIO FILE METADATA:
${metaContext}

Score this audio file's relevance to the user's intent.`
            }
          ],
          max_tokens: 150,
        });

        const parsed = JSON.parse(resp.choices[0].message.content || "{}");
        score = Number(parsed.score) || 0;
        console.log(`[gpt-audio] ${path.basename(a.filename)} — score ${score.toFixed(2)} | ${parsed.reason ?? ""}`);

      } catch (err: any) {
        console.warn(`[gpt-audio] GPT scoring failed for ${path.basename(a.filename)}: ${err?.message} — using metadata fallback`);
        score = scoreAudioByMetadata(a, intent);
      }

      scoredAssets.push({ asset: a, score });

      if (score >= MIN_SCORE) {
        await ensureDir(REL_AUD);
        const dest = path.join(REL_AUD, path.basename(a.filename));
        await fs.promises.copyFile(a.filename, dest);
        finalRelevantAssets.push({ ...a, filename: dest });
        console.log(`✅ Selected (${score.toFixed(2)}): ${path.basename(a.filename)}`);
      } else {
        console.log(`❌ Rejected (${score.toFixed(2)}): ${path.basename(a.filename)}`);
      }
    }
  }

  // ── Image / Video scoring ─────────────────────────────────────────────────
  for (let i = 0; i < mediaToScore.length; i += BATCH_SIZE) {
    const batch = mediaToScore.slice(i, i + BATCH_SIZE);
    const contentParts = [];
    const validAssets: FetchedAsset[] = [];

    for (const asset of batch) {
      const isVideo = asset.type === "video";
      let framePaths: string[] = [];
      let validDataUrls: string[] = [];

      if (isVideo) {
        const tempPrefix = path.join(
          process.cwd(),
          `temp_match_${Date.now()}_${Math.random().toString(36).substring(7)}`
        );
        try {
          await execAsync(
            `"${ffmpeg}" -y -i "${asset.filename}" -vf "fps=1" -vframes 3 "${tempPrefix}_%03d.jpg"`
          );
          for (let f = 1; f <= 3; f++) {
            const fPath = `${tempPrefix}_${f.toString().padStart(3, "0")}.jpg`;
            if (fs.existsSync(fPath)) framePaths.push(fPath);
          }
        } catch (e) {
          console.error("Failed to extract frames for video", asset.filename);
        }
      } else {
        framePaths.push(asset.filename);
      }

      for (const p of framePaths) {
        const dataUrl = await processImageForAPI(p);
        if (dataUrl) validDataUrls.push(dataUrl);
      }

      if (isVideo) {
        for (const p of framePaths) await fs.promises.unlink(p).catch(() => { });
      }

      if (!validDataUrls.length) continue;

      for (const dataUrl of validDataUrls) {
        contentParts.push({
          type: "image_url" as const,
          image_url: { url: dataUrl, detail: "low" as const },
        });
      }

      validAssets.push(asset);
    }

    if (!contentParts.length) continue;

    console.log(`📡 Evaluating ${contentParts.length} images`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
You are an expert visual relevance evaluator.

Evaluate how well each image (or sequence of video frames) matches the user's intent.

PRIMARY MATCH REQUIREMENTS:
- Must match primary action.
- Must match primary subject.

SECONDARY MATCH:
- Supporting objects improve score.

RELATIONSHIPS:
- Respect spatial relationships if present.

REJECT IF:
- action contradicts primary action
- subject is missing
- supporting object becomes dominant focus
- scene conflicts with prompt

NOTE ON MULTIPLE IMAGES:
If multiple images are presented for a single item, they represent sequential frames from a single video (1 second apart). Evaluate verbs, motion, and actions across these frames.

Return JSON:

{
  "results": [
    { "index": 0, "score": 0.92 },
    { "index": 1, "score": 0.31 }
  ]
}
`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `
USER PROMPT: "${prompt}"

PRIMARY SUBJECT: ${intent.primary_subject}
PRIMARY ACTION: ${intent.primary_action}
SUPPORTING OBJECTS: ${intent.supporting_objects?.join(", ")}
RELATIONSHIPS: ${intent.relationships?.join(", ")}

Evaluate images and score relevance (0–1).
`,
            },
            ...contentParts,
          ],
        },
      ],
    });

    const parsed = JSON.parse(response.choices[0].message.content || "{}");

    for (const r of parsed.results || []) {
      const asset = validAssets[r.index];
      if (!asset) continue;

      scoredAssets.push({ asset, score: r.score });

      if (r.score >= MIN_SCORE) {
        const targetDir = asset.type === "image" ? REL_IMG
          : asset.type === "video" ? REL_VID
            : REL_AUD;
        await ensureDir(targetDir);
        const dest = path.join(targetDir, path.basename(asset.filename));
        await fs.promises.copyFile(asset.filename, dest);

        finalRelevantAssets.push({ ...asset, filename: dest, relevance_score: r.score });

        console.log(`✅ Selected (${r.score.toFixed(2)}): ${path.basename(asset.filename)}`);
      } else {
        console.log(`❌ Rejected (${r.score.toFixed(2)}): ${path.basename(asset.filename)}`);
      }
    }
  }

  semanticMap.relevant_assets = finalRelevantAssets;
  await writeJson(SEMANTIC_MAP_PATH, semanticMap);
  console.log(`\n✨ Finished. Selected: ${finalRelevantAssets.length}`);

  // ── Metrics ───────────────────────────────────────────────────────────────
  const endTime = Date.now();
  const latency = endTime - startTime;

  scoredAssets.sort((a, b) => b.score - a.score);

  const K = 5;
  const topK = scoredAssets.slice(0, K);
  const correctInTopK = topK.filter(a => a.score >= MIN_SCORE).length;
  const precisionAtK = topK.length > 0 ? correctInTopK / topK.length : 0;

  const firstRelevantIndex = scoredAssets.findIndex(a => a.score >= MIN_SCORE);
  const mrr = firstRelevantIndex !== -1 ? 1 / (firstRelevantIndex + 1) : 0;

  const bestMatchScore = scoredAssets.length > 0 ? scoredAssets[0].score : 0;
  const visualDiversity = 0; // Planned for V2 with embedding persistence

  const filteringRatio = semanticMap.fetched_assets.length > 0
    ? (semanticMap.fetched_assets.length - finalRelevantAssets.length) / semanticMap.fetched_assets.length
    : 0;

  if (!semanticMap.evaluation_metrics) {
    semanticMap.evaluation_metrics = {
      timestamp: new Date().toISOString(),
      total_latency_ms: 0,
      system_health_score: 0,
    };
  }

  semanticMap.evaluation_metrics.stage4 = {
    latency_ms: latency,
    precision_at_k: precisionAtK,
    mrr,
    visual_diversity_score: visualDiversity,
    filtering_ratio: filteringRatio,
    best_match_score: bestMatchScore,
  };

  await writeJson(SEMANTIC_MAP_PATH, semanticMap);
}
// transcribeAudioFile and scoreTextAgainstIntent removed —
// audio relevance is now scored by GPT-4o-mini using file metadata only.
// Whisper was unreliable for instrumental/ambient/SFX audio (no speech = empty transcription).