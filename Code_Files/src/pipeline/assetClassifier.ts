// src/pipeline/assetClassifier.ts

import fs from "fs";
import path from "path";
import util from "util";
import { exec } from "child_process";
import ffprobe from "ffprobe-static";
import ffmpeg from "ffmpeg-static";
import OpenAI from "openai";
import sizeOf from "image-size";
import sharp from "sharp";
import { readJson, writeJson } from "../utils/fileUtils";
import { SEMANTIC_MAP_PATH } from "../config/constants";
import type { SemanticMap, AssetSemantics } from "../types/semanticMap";

const execAsync = util.promisify(exec);
const ColorThief = require('colorthief');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ------------------------------------------------ */
/* ------------------ HELPERS --------------------- */
/* ------------------------------------------------ */

async function safeUnlink(filePath: string, retries = 5) {
  if (!filePath || !fs.existsSync(filePath)) return;

  for (let i = 0; i < retries; i++) {
    try {
      await fs.promises.unlink(filePath);
      return;
    } catch (err: any) {
      if (err.code === "EPERM" || err.code === "EBUSY") {
        await new Promise((res) => setTimeout(res, 200));
      } else {
        throw err;
      }
    }
  }
}

function parseRatio(w: number, h: number): string {
  const r = w / h;
  if (Math.abs(r - 1) < 0.05) return "1:1";
  if (Math.abs(r - 16 / 9) < 0.05) return "16:9";
  if (Math.abs(r - 9 / 16) < 0.05) return "9:16";
  if (Math.abs(r - 4 / 3) < 0.05) return "4:3";
  return `${w}:${h}`;
}

function getOrientation(w: number, h: number) {
  if (!w || !h) return "unknown";
  if (w > h) return "landscape";
  if (h > w) return "portrait";
  return "square";
}

/* ------------------------------------------------ */
/* ----------- TECHNICAL PROBE (Layer 1) --------- */
/* ------------------------------------------------ */

async function probe(file: string) {
  if (!ffprobe?.path) return null;

  try {
    const stats = await fs.promises.stat(file);
    if (stats.size === 0) return null;

    try {
      const cmd = `"${ffprobe.path}" -v error -print_format json -show_streams -show_format "${file}"`;
      const { stdout } = await execAsync(cmd);
      const meta = JSON.parse(stdout);

      const stream = meta.streams?.find((s: any) => s.width && s.height);

      // Audio-only file — no video stream with dimensions
      if (!stream) {
        const audioStream = meta.streams?.find((s: any) => s.codec_type === "audio");
        if (audioStream) {
          return {
            width         : 0,
            height        : 0,
            type          : "audio" as const,
            orientation   : "n/a",
            aspect_ratio  : "n/a",
            duration      : meta.format?.duration ? parseFloat(meta.format.duration) : 0,
            codec         : audioStream.codec_name,
            file_size_mb  : +(stats.size / 1024 / 1024).toFixed(2),
          };
        }
        throw new Error("No valid stream");
      }

      const width      = Number(stream.width);
      const height     = Number(stream.height);
      const formatName = (meta.format?.format_name || "").toLowerCase();
      const isImage    =
        formatName.includes("image") ||
        formatName.includes("png")   ||
        formatName.includes("webp")  ||
        stream.codec_name === "mjpeg";

      return {
        width,
        height,
        type        : isImage ? "image" as const : "video" as const,
        orientation : getOrientation(width, height),
        aspect_ratio: parseRatio(width, height),
        duration    : isImage
          ? 0
          : meta.format?.duration ? parseFloat(meta.format.duration) : 0,
        codec        : stream.codec_name,
        file_size_mb : +(stats.size / 1024 / 1024).toFixed(2),
      };
    } catch {
      const ext             = path.extname(file).toLowerCase();
      const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"];

      if (imageExtensions.includes(ext)) {
        const buffer     = fs.readFileSync(file);
        const dimensions = sizeOf(buffer);

        return {
          width       : dimensions.width!,
          height      : dimensions.height!,
          type        : "image" as const,
          orientation : getOrientation(dimensions.width!, dimensions.height!),
          aspect_ratio: parseRatio(dimensions.width!, dimensions.height!),
          duration    : 0,
          codec       : dimensions.type || ext.replace(".", ""),
          file_size_mb: 0,
        };
      }
      return null;
    }
  } catch {
    return null;
  }
}

/* ------------------------------------------------ */
/* ----------- OPENAI VISION SEMANTICS ----------- */
/* ------------------------------------------------ */

async function getOpenAIVisualSemantics(filePaths: string[]) {
  try {
    const contentPayload: any[] = [
      {
        type: "text",
        text: `
Analyze this image (or sequence of video frames) and return structured JSON describing its visual semantics.

If multiple images are provided, they are sequential frames from a single video (1 second apart). Describe the actions and motion observed.

Return ONLY valid JSON with the following fields:

{
  "primary_scene": "",
  "environment": "",
  "time_of_day": "",
  "weather": "",
  "indoor_outdoor": "",
  "shot_type": "",
  "camera_angle": "",
  "composition": "",
  "lighting": "",
  "mood": "",
  "atmosphere": "",
  "human_presence": true,
  "people_count_estimate": 0,
  "primary_activity": "",
  "dominant_objects": [],
  "tags": [],
  "confidence": 0.0
}

Guidelines:
- Describe what is visually observable.
- Do NOT invent unseen details.
- Keep tags useful for media search.
- Use simple professional terminology.
`
      }
    ];

    for (const filePath of filePaths) {
      const processedImageBuffer = await sharp(filePath)
        .jpeg({ quality: 80 })
        .toBuffer();

      const base64Image = processedImageBuffer.toString("base64");

      contentPayload.push({
        type      : "image_url",
        image_url : { url: `data:image/jpeg;base64,${base64Image}` },
      });
    }

    const response = await openai.chat.completions.create({
      model           : "gpt-4o",
      messages        : [{ role: "user", content: contentPayload }],
      response_format : { type: "json_object" },
    });

    return JSON.parse(response.choices[0].message.content || "{}");
  } catch (err: any) {
    const errorPaths = filePaths.map(p => path.basename(p)).join(", ");
    console.error(`[Vision Error] Failed on ${errorPaths}: ${err.message}`);
    return null;
  }
}

/* ------------------------------------------------ */
/* ----------- OPENAI AUDIO SEMANTICS  ----------- */
/* Describes the audio content using GPT-4o        */
/* with a text-based prompt + Whisper transcription */
/* as context (GPT-4o Audio may not be available   */
/* on all API tiers, so we use a robust fallback)  */
/* ------------------------------------------------ */

async function getOpenAIAudioSemantics(filePath: string): Promise<AssetSemantics | null> {
  try {
    const ext    = path.extname(filePath).replace(".", "").toLowerCase();
    const b64    = fs.readFileSync(filePath).toString("base64");
    const fmt    = (["mp3", "wav", "ogg", "flac", "m4a"].includes(ext) ? ext : "mp3") as
                   "mp3" | "wav" | "ogg" | "flac" | "m4a";

    // Attempt GPT-4o Audio Preview (richer analysis if available on tier)
    try {
      const response = await (openai.chat.completions.create as any)({
        model           : "gpt-4o-audio-preview",
        response_format : { type: "json_object" },
        messages        : [{
          role   : "user",
          content: [
            {
              type        : "input_audio",
              input_audio : { data: b64, format: fmt },
            },
            {
              type: "text",
              text: `
Analyze this audio file and return structured JSON describing its acoustic semantics.

Return ONLY valid JSON with these fields:

{
  "audio_type": "",
  "primary_sound": "",
  "mood": "",
  "atmosphere": "",
  "intensity_level": "",
  "speech_present": false,
  "music_present": false,
  "sound_effects_present": false,
  "emotion": "",
  "tags": [],
  "use_cases": [],
  "acoustic_characteristics": {
    "frequency_range": "",
    "clarity": "",
    "background_noise": ""
  },
  "confidence": 0.0
}

Guidelines:
- audio_type: music | speech | sfx | ambient | mixed
- intensity_level: low | medium | high
- Keep tags useful for audio search (e.g. "rain", "upbeat", "cinematic")
- use_cases: where this audio would be used (e.g. "background music", "sound effect")
`,
            },
          ],
        }],
        max_tokens: 600,
      });

      const parsed = JSON.parse(response.choices[0].message.content || "{}");
      console.log(`[audio-classify] GPT-4o Audio used for ${path.basename(filePath)}`);
      return parsed as AssetSemantics;

    } catch (audioErr: any) {
      // GPT-4o Audio Preview not available — fall back to text model
      // using filename + query metadata as context
      console.warn(`[audio-classify] GPT-4o Audio unavailable, using text fallback: ${audioErr?.message}`);
    }

    // Fallback: describe audio from filename + query context using gpt-4o text
    const filename   = path.basename(filePath, path.extname(filePath));
    const cleanName  = filename.replace(/[_-]/g, " ").replace(/[a-f0-9]{8,}/g, "").trim();

    const fallback = await openai.chat.completions.create({
      model           : "gpt-4o",
      response_format : { type: "json_object" },
      messages        : [{
        role   : "user",
        content: `
Based on this audio filename: "${cleanName}", provide a best-effort audio semantic description.

Return ONLY valid JSON:

{
  "audio_type": "",
  "primary_sound": "",
  "mood": "",
  "atmosphere": "",
  "intensity_level": "",
  "speech_present": false,
  "music_present": false,
  "sound_effects_present": false,
  "emotion": "",
  "tags": [],
  "use_cases": [],
  "acoustic_characteristics": {
    "frequency_range": "",
    "clarity": "",
    "background_noise": ""
  },
  "confidence": 0.3
}
`,
      }],
      max_tokens: 400,
    });

    return JSON.parse(fallback.choices[0].message.content || "{}") as AssetSemantics;

  } catch (err: any) {
    console.error(`[Audio Classify Error] ${path.basename(filePath)}: ${err.message}`);
    return null;
  }
}

/* ------------------------------------------------ */
/* ---------------- MAIN PIPELINE ----------------- */
/* ------------------------------------------------ */

export async function runAssetClassification(): Promise<void> {
  console.log("==================================================");
  console.log("🏷️  OPENAI VISION ASSET CLASSIFICATION");
  console.log("==================================================");

  const semanticMap = await readJson<SemanticMap>(SEMANTIC_MAP_PATH);
  if (!semanticMap?.relevant_assets?.length) return;

  for (const asset of semanticMap.relevant_assets) {
    const techData = await probe(asset.filename);
    if (!techData) continue;

    // ── Audio asset ──────────────────────────────────────────────────────────
    if (techData.type === "audio") {
      console.log(`[classifying audio] ${path.basename(asset.filename)}`);

      const audioSemantics = await getOpenAIAudioSemantics(asset.filename);

      asset.classification = {
        technical   : techData,
        origin      : asset.source?.includes("fal") ? "generated" : "scraped",
        aspect_ratio: "n/a",
        semantics   : audioSemantics ?? {},
      } as any;

      console.log(`[classified] ${path.basename(asset.filename)}`);
      continue;
    }

    // ── Image / Video asset ───────────────────────────────────────────────────
    let framePaths: string[] = [asset.filename];

    if (techData.type === "video") {
      framePaths = [];
      const tempPrefix = path.join(
        process.cwd(),
        `temp_frame_${Date.now()}_${Math.random().toString(36).substring(7)}`
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
    }

    const semantics = await getOpenAIVisualSemantics(framePaths);

    let palette: string[] = [];
    try {
      const paletteRgb = await ColorThief.getPalette(framePaths[0], 5);
      palette = paletteRgb.map((rgb: number[]) =>
        "#" + rgb.map((x: number) => x.toString(16).padStart(2, "0")).join("")
      );
    } catch {
      palette = [];
    }

    if (techData.type === "video") {
      for (const p of framePaths) await safeUnlink(p);
    }

    asset.classification = {
      technical   : techData,
      origin      : asset.source?.includes("fal") ? "generated" : "scraped",
      aspect_ratio: techData.aspect_ratio,
      semantics   : { ...(semantics || {}), palette },
    } as any;

    console.log(`[classified] ${path.basename(asset.filename)}`);
  }

  /* ── Console output ───────────────────────────────────────────────────── */
  console.log("\n" + "=".repeat(60));
  console.log("🎯 FINAL RELEVANT ASSETS");
  console.log("=".repeat(60));

  semanticMap.relevant_assets.forEach((asset, i) => {
    const tech = asset.classification?.technical as any;
    const sem  = asset.classification?.semantics  || {};
    const type = tech?.type ?? "unknown";

    console.log(`\n${type === "audio" ? "🔊" : "🖼️ "} Asset ${i + 1}`);
    console.log("-".repeat(60));
    console.log(`File        : ${path.basename(asset.filename)}`);
    console.log(`Source      : ${asset.source}`);
    console.log(`Type        : ${type}`);

    if (type === "audio") {
      // Audio-specific display
      console.log(`Duration    : ${tech?.duration?.toFixed(1) ?? "N/A"}s`);
      console.log(`Codec       : ${tech?.codec ?? "N/A"}`);
      console.log(`Size        : ${tech?.file_size_mb ?? "N/A"} MB`);

      console.log("\n🔉 Audio Semantics");
      console.log(`Audio Type  : ${sem.audio_type        || "N/A"}`);
      console.log(`Primary Sound: ${sem.primary_sound    || "N/A"}`);
      console.log(`Mood        : ${sem.mood               || "N/A"}`);
      console.log(`Atmosphere  : ${sem.atmosphere         || "N/A"}`);
      console.log(`Intensity   : ${sem.intensity_level    || "N/A"}`);
      console.log(`Emotion     : ${sem.emotion            || "N/A"}`);
      console.log(`Speech      : ${sem.speech_present     ?? "N/A"}`);
      console.log(`Music       : ${sem.music_present      ?? "N/A"}`);
      console.log(`SFX         : ${sem.sound_effects_present ?? "N/A"}`);

      console.log("\n🏷️  Tags");
      console.log((sem.tags || []).join(", ") || "N/A");

      console.log("\n🎬 Use Cases");
      console.log((sem.use_cases || []).join(", ") || "N/A");

      if (sem.acoustic_characteristics) {
        console.log("\n🎛️  Acoustic Characteristics");
        console.log(`Freq Range  : ${sem.acoustic_characteristics.frequency_range  || "N/A"}`);
        console.log(`Clarity     : ${sem.acoustic_characteristics.clarity           || "N/A"}`);
        console.log(`BG Noise    : ${sem.acoustic_characteristics.background_noise  || "N/A"}`);
      }

    } else {
      // Image / Video display (unchanged)
      console.log(`Resolution  : ${tech?.width}x${tech?.height}`);
      console.log(`Aspect Ratio: ${tech?.aspect_ratio}`);

      console.log("\n📍 Scene Understanding");
      console.log(`Scene       : ${sem.primary_scene || "N/A"}`);
      console.log(`Environment : ${sem.environment   || "N/A"}`);
      console.log(`Time of Day : ${sem.time_of_day   || "N/A"}`);
      console.log(`Weather     : ${sem.weather        || "N/A"}`);

      console.log("\n🎬 Cinematic Attributes");
      console.log(`Lighting    : ${sem.lighting      || "N/A"}`);
      console.log(`Shot Type   : ${sem.shot_type     || "N/A"}`);
      console.log(`Camera Angle: ${sem.camera_angle  || "N/A"}`);
      console.log(`Mood        : ${sem.mood           || "N/A"}`);

      console.log("\n👤 Content");
      console.log(`Human       : ${sem.human_presence ?? "N/A"}`);
      console.log(`Activity    : ${sem.primary_activity || "N/A"}`);

      console.log("\n🏷️  Tags");
      console.log((sem.tags || []).join(", ") || "N/A");

      console.log("\n🎨 Color Palette");
      console.log((sem.palette || []).join(", ") || "N/A");
    }
  });

  // Summary table — image/video only (audio has no scene/mood to table)
  const visualAssets = semanticMap.relevant_assets.filter(
    a => (a.classification?.technical as any)?.type !== "audio"
  );

  if (visualAssets.length > 0) {
    const summaryData = visualAssets.map(asset => ({
      File    : path.basename(asset.filename),
      Scene   : asset.classification?.semantics?.primary_scene || "N/A",
      Mood    : asset.classification?.semantics?.mood          || "N/A",
      Lighting: asset.classification?.semantics?.lighting      || "N/A",
    }));
    console.table(summaryData);
  }

  const finalResults = semanticMap.relevant_assets.map(asset => ({
    file        : path.basename(asset.filename),
    source      : asset.source || "unknown",
    type        : asset.classification?.technical?.type,
    width       : asset.classification?.technical?.width,
    height      : asset.classification?.technical?.height,
    aspect_ratio: asset.classification?.technical?.aspect_ratio,
    classification: asset.classification?.semantics || {},
  }));

  semanticMap.results = finalResults;
  await writeJson(SEMANTIC_MAP_PATH, semanticMap);

  console.log("==================================================");
  console.log("✅ Classification Complete");
  console.log("==================================================");
}