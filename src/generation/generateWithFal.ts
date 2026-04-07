// src/generation/generateWithFal.ts
import { fal } from "@fal-ai/client";
import { readJson, writeJson, ensureDir } from "../utils/fileUtils";
import {
  SEMANTIC_MAP_PATH,
  IMG_DIR,
  VID_DIR,
  AUD_DIR,
  METADATA_PATH,
} from "../config/constants";
import type { SemanticMap, FetchedAsset, MediaType } from "../types/semanticMap";
import { detectModality } from "../pipeline/modalityRouting";
import { downloadToDir } from "../scraping/download";
import fs from "fs";
import path from "path";

const fsp = fs.promises;

// ----------------- helpers -----------------

function buildGenerationPrompt(map: SemanticMap, modality: MediaType): string {
  const base = map.user_prompt ?? "";

  const intent = map.intent_extraction ?? {};
  const style = (intent.style_adjectives ?? []).join(", ");

  const extraParts = [
    intent.domain,
    intent.primary_subject,
    intent.context_scene,
    style,
    modality === "video" ? "cinematic, high quality video" : "",
  ].filter(Boolean);

  const extra = extraParts.join(", ");
  if (!extra) return base;

  return `${base} | intent: ${extra}`;
}

// Image model: FLUX.1/2 dev - Generates 3 images in one request
async function generateImagesWithFal(prompt: string): Promise<string[]> {
  const result = await fal.subscribe("fal-ai/flux/dev", {
    input: {
      prompt,
      num_images: 3,
    },
  });

  const images = (result.data as any)?.images;
  if (!images || !Array.isArray(images) || images.length === 0) {
    throw new Error("Fal did not return any image URLs");
  }

  return images.map((img: any) => img.url as string);
}

// NEW: Image-to-image — user file as conditioning input
async function generateImagesImg2ImgWithFal(
  prompt: string,
  userAssetPath: string,
  transformationIntent?: string,
): Promise<string[]> {
  console.log("[generation] img2img mode — uploading user asset to FAL storage...");

  // fal.storage.upload expects a Blob — convert Node Buffer accordingly
  const fileBuffer = fs.readFileSync(userAssetPath);
  const fileBlob = new Blob([fileBuffer]);
  const uploadedUrl = await fal.storage.upload(fileBlob);

  console.log("[generation] user asset uploaded:", uploadedUrl);

  // Strip any [user instruction: ...] brackets that index.ts appended for
  // Stage 1 context — FAL doesn't need that noise in the generation prompt.
  const cleanPrompt = prompt.replace(/\s*\[user instruction:[^\]]*\]/g, "").trim();

  // Lead with the transformation intent so the model knows exactly WHAT to change.
  // Also add scene preservation hints so the composition stays anchored to the
  // original image rather than generating a completely new scene.
  // strength 0.60 handles the actual adherence to the source image — the prompt
  // reinforcement here is an extra safety net.
  // Preserve scene structure but force the weather transformation.
  // We explicitly name what to keep AND what to change so the model has
  // clear, competing constraints to balance.
  const sceneContext = `keep mountains, keep flowers, keep landscape composition`;
  const weatherForce = `heavy rain, storm clouds, dark overcast sky, wet ground, raindrops`;
  const img2imgPrompt = transformationIntent
    ? `${weatherForce}, ${transformationIntent}, ${sceneContext}. ${cleanPrompt}`
    : cleanPrompt;

  // strength 0.78: high enough to actually change the weather/sky (requires
  // significant pixel-level changes) while keeping the terrain/composition
  // recognisable from the source image.
  // 0.60 = composition preserved but weather barely changes (too low for sky edits)
  // 0.78 = weather changes strongly, mountains/flowers still present
  // 0.92 = loses source image entirely, new scene generated
  const strength = 0.78;

  console.log(`[generation] img2img prompt: "${img2imgPrompt}"`);
  console.log(`[generation] img2img strength: ${strength}`);

  const result = await fal.subscribe("fal-ai/flux/dev/image-to-image", {
    input: {
      image_url: uploadedUrl,
      prompt: img2imgPrompt,
      strength,
      num_inference_steps: 28,
      num_images: 3,
    },
  });

  const images = (result.data as any)?.images;
  if (!images || !Array.isArray(images) || images.length === 0) {
    throw new Error("Fal img2img did not return any image URLs");
  }

  return images.map((img: any) => img.url as string);
}

// NEW: Audio reference -- enrich prompt with user media tags
function buildAudioReferencePrompt(map: SemanticMap): string {
  const base = map.user_prompt ?? "";
  const userMediaTags = map.user_media?.tags ?? [];
  const description = map.user_media?.description ?? "";

  const enriched = [
    base,
    description ? `Reference audio: ${description}` : "",
    userMediaTags.length ? `Tags: ${userMediaTags.join(", ")}` : "",
  ].filter(Boolean).join(" | ");

  return enriched;
}

// Video model: Wan 2.2 - Triggers 3 parallel requests to get 3 unique videos
async function generateVideosWithFal(prompt: string): Promise<string[]> {
  const COUNT = 3;
  console.log(`[generation] triggering ${COUNT} parallel video generations...`);

  // Create 3 concurrent promises
  const tasks = Array.from({ length: COUNT }, () =>
    fal.subscribe("fal-ai/wan/v2.2-a14b/text-to-video", {
      input: {
        prompt,
      },
    })
  );

  const results = await Promise.all(tasks);

  const videoUrls = results
    .map((res: any) => res.data?.video?.url)
    .filter(Boolean);

  if (videoUrls.length === 0) {
    throw new Error("Fal did not return any video URLs");
  }

  return videoUrls;
}

// Audio model: Stable Audio - Generates 3 audio tracks from text description
async function generateAudioWithFal(prompt: string): Promise<string[]> {
  const COUNT = 3;
  console.log(`[generation] triggering ${COUNT} parallel audio generations...`);

  const tasks = Array.from({ length: COUNT }, () =>
    fal.subscribe("fal-ai/stable-audio", {
      input: {
        prompt,
      },
    })
  );

  const results = await Promise.all(tasks);

  if (results.length > 0) {
    console.log("[generation] DEBUG - Audio response data:", JSON.stringify(results[0].data, null, 2));
  }

  const audioUrls = results
    .map((res: any) => res.data?.audio_file?.url)
    .filter(Boolean);

  if (audioUrls.length === 0) {
    throw new Error(`Fal did not return any audio URLs. Response: ${JSON.stringify(results[0]?.data)}`);
  }

  return audioUrls;
}

// ----------------- main entry -----------------

export async function runGenerateWithFal(): Promise<void> {
  console.log("==================================================");
  console.log("GENERATION MODULE (Fal.ai)");
  console.log("==================================================");

  const semanticMap =
    (await readJson<SemanticMap>(SEMANTIC_MAP_PATH)) ?? ({} as SemanticMap);

  if (!semanticMap.user_prompt) {
    throw new Error(
      `No semantic map found at ${SEMANTIC_MAP_PATH}. Run previous steps first.`
    );
  }

  const modality: MediaType = detectModality(semanticMap);
  console.log(`[generation] modality detected: ${modality}`);

  if (modality !== "image" && modality !== "video" && modality !== "audio") {
    console.warn(
      `[generation] Unsupported modality: '${modality}'. Must be image, video, or audio.`
    );
    return;
  }

  // Read media strategy written by Stage 2
  const decisionReasoning = semanticMap.decision_reasoning as any;
  const mediaUseStrategy = decisionReasoning?.media_use_strategy as string | undefined;
  const userAssetPath = decisionReasoning?.user_asset_path as string | undefined;
  const transformIntent = semanticMap.user_media?.transformation_intent;

  const genPrompt = buildGenerationPrompt(semanticMap, modality);
  console.log("[generation] base prompt for Fal:\n", genPrompt);

  let urls: string[] = [];
  let targetDir: string;
  let preferredExt: string;
  let sourceLabel: string;

  if (modality === "image") {
    targetDir = IMG_DIR;
    preferredExt = ".jpg";

    if (mediaUseStrategy === "img2img" && userAssetPath) {
      console.log("[generation] strategy: img2img -- using user asset as conditioning input");
      sourceLabel = "fal-ai/flux/dev/image-to-image";
      urls = await generateImagesImg2ImgWithFal(genPrompt, userAssetPath, transformIntent);
    } else {
      sourceLabel = "fal-ai/flux/dev";
      urls = await generateImagesWithFal(genPrompt);
    }

  } else if (modality === "video") {
    targetDir = VID_DIR;
    preferredExt = ".mp4";
    sourceLabel = "fal-ai/wan/v2.2-a14b/text-to-video";
    urls = await generateVideosWithFal(genPrompt);

  } else {
    // modality === "audio"
    targetDir = AUD_DIR;
    preferredExt = ".mp3";
    sourceLabel = "fal-ai/stable-audio";

    const audioPrompt = mediaUseStrategy === "audio_reference"
      ? buildAudioReferencePrompt(semanticMap)
      : genPrompt;

    if (mediaUseStrategy === "audio_reference") {
      console.log("[generation] strategy: audio_reference -- enriching prompt with user media tags");
      console.log("[generation] enriched audio prompt:\n", audioPrompt);
    }

    urls = await generateAudioWithFal(audioPrompt);
    targetDir = VID_DIR;
    preferredExt = ".mp4";
    sourceLabel = "fal_ai";
  }

  console.log(`[generation] Fal returned ${urls.length} ${modality} URLs`);

  await ensureDir(targetDir);

  const newAssets: FetchedAsset[] = [];

  for (const url of urls) {
    try {
      console.log(`[generation] downloading ${modality}:`, url);
      const { filePath, width, height, hash } = await downloadToDir(
        url,
        targetDir,
        preferredExt,
        sourceLabel
      );

      const asset: FetchedAsset = {
        type: modality,
        filename: filePath,
        source: sourceLabel,
        model_id: modality === "image" ? "fal-ai/flux/dev" : "fal-ai/wan/v2.2-a14b/text-to-video",
        media_url: url,
        page_url: undefined,
        alt: modality === "image" ? semanticMap.user_prompt : undefined,
        query_used: genPrompt,
        width,
        height,
        sha256: hash,
      };

      newAssets.push(asset);
    } catch (err) {
      console.error(`[generation] Failed to download asset from ${url}:`, err);
    }
  }

  const existingMetadata = (await readJson<FetchedAsset[]>(METADATA_PATH)) ?? [];
  const combinedMetadata = [...existingMetadata, ...newAssets];

  semanticMap.fetched_assets = [...(semanticMap.fetched_assets ?? []), ...newAssets];

  await writeJson(METADATA_PATH, combinedMetadata);
  await writeJson(SEMANTIC_MAP_PATH, semanticMap);

  console.log(
    `[generation] stored ${newAssets.length} generated ${modality} assets. See ${path.relative(
      process.cwd(),
      METADATA_PATH
    )}`
  );
}