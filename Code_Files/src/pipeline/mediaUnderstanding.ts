// src/pipeline/mediaUnderstanding.ts
// ─────────────────────────────────────────────────────────────────────────────
// STAGE 0 — User Media Understanding
//
// Called from index.ts ONLY when the user has attached a file alongside their
// prompt. Analyses the file with the appropriate OpenAI model and returns a
// rich MediaContext object that Stage 1 (promptUnderstanding.ts) consumes.
//
// Supported modalities:
//   Image  → GPT-4o Vision (base64 encoded)
//   Audio  → Whisper-1 (transcription) + GPT-4o Audio (description)
//   Video  → FFmpeg keyframe extraction → GPT-4o Vision on the keyframe
//
// Entry point:  analyseUserMedia(filePath: string): Promise<MediaContext>
// ─────────────────────────────────────────────────────────────────────────────

import fs   from "fs";
import path from "path";
import { openaiClient } from "../openai/client";
import { MediaContext, MediaModality } from "../types/semanticMap";

// ─── Constants ───────────────────────────────────────────────────────────────

const VISION_MODEL = "gpt-4o";
const AUDIO_MODEL  = "gpt-4o-audio-preview";
const WHISPER_MODEL = "whisper-1";

/** Map of file extensions → MediaModality */
const EXT_MAP: Record<string, MediaModality> = {
  // Images
  jpg: "image", jpeg: "image", png: "image",
  webp: "image", gif: "image", bmp: "image", tiff: "image",
  // Videos
  mp4: "video", mov: "video", avi: "video",
  mkv: "video", webm: "video", m4v: "video",
  // Audio
  mp3: "audio", wav: "audio", ogg: "audio",
  flac: "audio", aac: "audio", m4a: "audio",
};

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
  flac: "audio/flac", aac: "audio/aac", m4a: "audio/mp4",
};

// ─── Public Entry Point ───────────────────────────────────────────────────────

/**
 * Analyse a user-uploaded media file and return a structured MediaContext.
 * This is the only function index.ts needs to call.
 *
 * @param filePath  Absolute (or CWD-relative) path to the uploaded file
 */
export async function analyseUserMedia(filePath: string): Promise<MediaContext> {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`[Stage 0] File not found: ${resolvedPath}`);
  }

  const modality = detectModality(resolvedPath);
  console.log(`[Stage 0] Detected modality: ${modality} for "${path.basename(resolvedPath)}"`);

  switch (modality) {
    case "image": return analyseImage(resolvedPath);
    case "audio": return analyseAudio(resolvedPath);
    case "video": return analyseVideo(resolvedPath);
  }
}

// ─── Modality Detection ───────────────────────────────────────────────────────

function detectModality(filePath: string): MediaModality {
  const ext = path.extname(filePath).replace(".", "").toLowerCase();
  const modality = EXT_MAP[ext];

  if (!modality) {
    throw new Error(
      `[Stage 0] Unsupported file extension ".${ext}". ` +
      `Supported: ${Object.keys(EXT_MAP).join(", ")}`
    );
  }

  return modality;
}

// ─── Image Analysis ───────────────────────────────────────────────────────────

async function analyseImage(filePath: string): Promise<MediaContext> {
  console.log("[Stage 0] Analysing image with GPT-4o Vision…");

  const ext    = path.extname(filePath).replace(".", "").toLowerCase();
  const mime   = MIME_MAP[ext] ?? "image/jpeg";
  const b64    = fs.readFileSync(filePath).toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;

  const response = await openaiClient.chat.completions.create({
    model: VISION_MODEL,
    messages: [{
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: dataUrl },
        },
        {
          type: "text",
          text: `Analyse this image and respond ONLY with a valid JSON object (no markdown, no backticks).

{
  "description": "A detailed 2-3 sentence description of the scene",
  "primary_scene": "one-phrase label for the scene",
  "mood": "emotional tone of the image",
  "lighting": "lighting conditions",
  "dominant_colours": ["colour1", "colour2", "colour3"],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "resolution_hint": "approximate dimensions if determinable, else null"
}`,
        },
      ],
    }],
    response_format: { type: "json_object" },
    max_tokens: 500,
  });

  const raw = JSON.parse(response.choices[0].message.content ?? "{}");

  return {
    filePath,
    modality: "image",
    description: raw.description ?? "",
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
}

// ─── Audio Analysis ───────────────────────────────────────────────────────────

async function analyseAudio(filePath: string): Promise<MediaContext> {
  console.log("[Stage 0] Analysing audio — transcribing with Whisper…");

  // Step 1 — Transcribe speech (Whisper handles non-speech gracefully)
  let transcription: string | undefined;
  try {
    const whisperResult = await openaiClient.audio.transcriptions.create({
      file : fs.createReadStream(filePath) as any,
      model: WHISPER_MODEL,
    });
    // Only keep transcription if there's meaningful speech content
    const trimmed = whisperResult.text.trim();
    if (trimmed.length > 0) {
      transcription = trimmed;
    }
  } catch (err) {
    console.warn("[Stage 0] Whisper transcription failed (non-fatal):", err);
  }

  // Step 2 — Describe the audio character
  console.log("[Stage 0] Describing audio character with GPT-4o…");

  // We use a text-based description prompt here because gpt-4o-audio-preview
  // may not be available in all deployments. The fallback uses Whisper output
  // + file name heuristics to build a description via the chat model.
  const descriptionPrompt = transcription
    ? `The following is a transcription of an audio file: "${transcription}".
       Based on this transcription and the filename "${path.basename(filePath)}", ` +
      `describe the audio in detail.`
    : `Based solely on the filename "${path.basename(filePath)}", ` +
      `make a best-effort description of what this audio file likely contains.`;

  let description = "";
  let tags: string[] = [];

  try {
    // Attempt GPT-4o Audio if available
    const b64   = fs.readFileSync(filePath).toString("base64");
    const ext   = path.extname(filePath).replace(".", "").toLowerCase();
    const fmt   = (ext === "mp3" ? "mp3" : ext === "wav" ? "wav" : "mp3") as "mp3" | "wav";

    const audioResponse = await (openaiClient.chat.completions.create as any)({
      model: AUDIO_MODEL,
      messages: [{
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { data: b64, format: fmt },
          },
          {
            type: "text",
            text: `Analyse this audio and respond ONLY with valid JSON (no markdown).

{
  "description": "2-3 sentence description of the audio content",
  "audio_type": "music | speech | sfx | ambient | mixed",
  "primary_sound": "main sound source (e.g. dog barking, piano, crowd)",
  "mood": "emotional tone",
  "intensity": "low | medium | high",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}`,
          },
        ],
      }],
      response_format: { type: "json_object" },
      max_tokens: 400,
    });

    const raw = JSON.parse(audioResponse.choices[0].message.content ?? "{}");
    description = raw.description ?? "";
    tags = Array.isArray(raw.tags) ? raw.tags : [];

  } catch (audioErr) {
    // Fallback: GPT-4o Audio not available — use text model with transcription context
    console.warn("[Stage 0] GPT-4o Audio unavailable, falling back to text model…");

    const fallbackResponse = await openaiClient.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: descriptionPrompt + `
        
Respond ONLY with valid JSON (no markdown):
{
  "description": "2-3 sentence description",
  "primary_sound": "main sound source",
  "mood": "emotional tone",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}`,
      }],
      response_format: { type: "json_object" },
      max_tokens: 400,
    });

    const raw = JSON.parse(fallbackResponse.choices[0].message.content ?? "{}");
    description = raw.description ?? "";
    tags = Array.isArray(raw.tags) ? raw.tags : [];
  }

  return {
    filePath,
    modality: "audio",
    description,
    tags,
    transcription,
  };
}

// ─── Video Analysis ───────────────────────────────────────────────────────────

async function analyseVideo(filePath: string): Promise<MediaContext> {
  console.log("[Stage 0] Analysing video — extracting keyframe with FFmpeg…");

  const keyframePath = await extractKeyframe(filePath);
  const duration     = await getVideoDuration(filePath);

  // Reuse image analyser on the keyframe
  const imageContext = await analyseImage(keyframePath);

  // Clean up the temporary keyframe
  try { fs.unlinkSync(keyframePath); } catch { /* non-fatal */ }

  return {
    filePath,
    modality: "video",
    description: imageContext.description,
    tags: imageContext.tags,
    duration,
  };
}

// ─── FFmpeg Helpers ───────────────────────────────────────────────────────────

/**
 * Extract the frame at the midpoint of a video file.
 * Returns the path to the saved JPEG keyframe.
 */
function extractKeyframe(videoPath: string): Promise<string> {
  // Dynamic import so the module only loads when a video is actually provided
  const ffmpeg = require("fluent-ffmpeg");

  const keyframePath = videoPath.replace(/\.[^.]+$/, "_stage0_keyframe.jpg");

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .on("error", (err: Error) => reject(new Error(`[Stage 0] FFmpeg keyframe error: ${err.message}`)))
      .on("end",   ()           => resolve(keyframePath))
      .screenshots({
        timestamps : ["50%"],          // middle of the video
        filename   : path.basename(keyframePath),
        folder     : path.dirname(keyframePath),
        size       : "1280x?",         // preserve aspect ratio, cap width at 1280px
      });
  });
}

/**
 * Probe a video file and return its duration in seconds.
 * Returns 0 if FFprobe fails (non-fatal).
 */
function getVideoDuration(videoPath: string): Promise<number> {
  const ffmpeg = require("fluent-ffmpeg");

  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err: Error | null, meta: any) => {
      if (err || !meta?.format?.duration) {
        console.warn("[Stage 0] FFprobe duration failed (non-fatal):", err?.message);
        resolve(0);
      } else {
        resolve(parseFloat(meta.format.duration));
      }
    });
  });
}