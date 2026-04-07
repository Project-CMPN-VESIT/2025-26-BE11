// src/scraping/fetchAssets.ts
import fs from "fs";
import path from "path";
import { createBrowser, newPage } from "./browser";
import { buildSearchQueries } from "../scraping/queryBuilder";
import { detectModality } from "../pipeline/modalityRouting";
import { readJson, writeJson, ensureDir } from "../utils/fileUtils";
import {
  DEST_DIR,
  IMG_DIR,
  VID_DIR,
  AUD_DIR,
  METADATA_PATH,
  SEMANTIC_MAP_PATH,
  MAX_PER_PROVIDER,
} from "../config/constants";
import type { SemanticMap, FetchedAsset, MediaType } from "../types/semanticMap";

import { downloadToDir } from "./download";
import {
  scrapeUnsplashImages,
  scrapePexelsImages,
  scrapePixabayImages,
  ScrapedItem,
} from "./imageProviders";
import { scrapePixabayVideos, scrapePexelsVideos, scrapeCoverrVideos } from "./videoProviders";
import {
  scrapeMixkitAudio,
  scrapePixabayAudio,
  scrapeFreesoundPreviews
} from "./audioProviders";
import { scrapeFreesoundAudio, scrapeFreesoundBrowserAudio } from "./freeSoundProvider";

const fsp = fs.promises;

type ProviderFn =
  | ((page: any, q: string, limit: number) => Promise<ScrapedItem[]>)
  | ((browser: any, q: string, limit: number) => Promise<ScrapedItem[]>);

async function fetchAndSave(items: ScrapedItem[], intent: any): Promise<FetchedAsset[]> {
  const metadata: FetchedAsset[] = [];
  const seenHashes = new Set<string>();

  await ensureDir(DEST_DIR);
  await ensureDir(IMG_DIR);
  await ensureDir(VID_DIR);
  await ensureDir(AUD_DIR);

  for (const item of items) {
    const { type, mediaUrl, source } = item;
    if (!mediaUrl) continue;

    try {
      const targetDir =
        type === "image" ? IMG_DIR : type === "video" ? VID_DIR : AUD_DIR;

      const preferredExt =
        type === "image" ? ".jpg" : type === "video" ? ".mp4" : ".mp3";

      const { filePath, contentType, width, height, hash } = await downloadToDir(
        mediaUrl,
        targetDir,
        preferredExt,
        item.source
      );

      // Audio pre-filter removed — Whisper scores SFX/ambient files as 0.00
      // because there is no speech to transcribe. This was deleting valid audio
      // assets before they reached the relevance matcher. Stage 4 relevanceMatcher
      // now handles audio scoring with proper metadata fallback for non-speech files.

      if (seenHashes.has(hash)) {
        await fsp.unlink(filePath).catch(() => { });
        continue;
      }
      seenHashes.add(hash);

      const asset: FetchedAsset = {
        type,
        filename: filePath,
        source: item.source,
        media_url: mediaUrl,
        page_url: item.pageUrl,
        alt: item.alt,
        query_used: item.query,
        width,
        height,
        sha256: hash,
      };

      metadata.push(asset);
      console.log(`[saved] ${type}: ${filePath}`);
    } catch (err) {
      console.warn("[download error]", err);
    }
  }

  return metadata;
}

export async function runFetchAssets(): Promise<void> {
  const startTime = Date.now();
  console.log("==================================================");
  console.log("📡 FETCH ASSETS MODULE (Step 3)");
  console.log("==================================================");

  const semanticMap =
    (await readJson<SemanticMap>(SEMANTIC_MAP_PATH)) ?? ({} as SemanticMap);

  if (!semanticMap.user_prompt) {
    throw new Error(
      `No semantic map found at ${SEMANTIC_MAP_PATH}. Run previous steps first.`
    );
  }

  const modality: MediaType = detectModality(semanticMap);
  console.log(`[route] modality detected: ${modality}`);

  const queryObj = await buildSearchQueries(semanticMap, modality);
  const queries = (queryObj.queries || [])
    .map((q) => q.trim())
    .filter((q) => q.length > 1);

  if (!queries.length) {
    console.log("[llm] no queries generated — exiting.");
    return;
  }

  console.log("[llm] queries:", queries);

  const browser = await createBrowser();
  const collected: ScrapedItem[] = [];

  try {
    if (modality === "image") {
      const page = await newPage(browser);
      for (const q of queries) {
        // Each provider gets its own try/catch — a bot-detection redirect on
        // Unsplash should NOT prevent Pexels and Pixabay from running.
        try {
          console.log(`[scrape] unsplash -> '${q}'`);
          collected.push(...(await scrapeUnsplashImages(page, q, MAX_PER_PROVIDER)));
        } catch (err: any) {
          console.warn(`[scrape] unsplash failed for '${q}': ${err?.message ?? err} — skipping provider`);
        }

        try {
          console.log(`[scrape] pexels -> '${q}'`);
          collected.push(...(await scrapePexelsImages(page, q, MAX_PER_PROVIDER)));
        } catch (err: any) {
          console.warn(`[scrape] pexels failed for '${q}': ${err?.message ?? err} — skipping provider`);
        }

        try {
          console.log(`[scrape] pixabay -> '${q}'`);
          collected.push(...(await scrapePixabayImages(page, q, MAX_PER_PROVIDER)));
        } catch (err: any) {
          console.warn(`[scrape] pixabay failed for '${q}': ${err?.message ?? err} — skipping provider`);
        }
      }
      await page.close();
    } else if (modality === "video") {
      for (const q of queries) {
        console.log(`[scrape] pixabay_videos -> '${q}'`);
        collected.push(...(await scrapePixabayVideos(browser, q, MAX_PER_PROVIDER)));

        console.log(`[scrape] pexels_videos -> '${q}'`);
        collected.push(...(await scrapePexelsVideos(browser, q, MAX_PER_PROVIDER)));

        console.log(`[scrape] coverr_videos -> '${q}'`);
        collected.push(...(await scrapeCoverrVideos(browser, q, MAX_PER_PROVIDER)));
      }
    } else {
      // Only Freesound API is active — other providers (Mixkit, Pixabay, Freesound browser/previews)
      // returned corrupt files, JSON error responses, or promotional speech clips.
      // Freesound API returns properly licensed, validated audio with rich metadata.
      for (const q of queries) {
        console.log(`[scrape] freesound_api -> '${q}'`);
        collected.push(...(await scrapeFreesoundAudio(q, MAX_PER_PROVIDER)));
      }
    }

    console.log(`[scrape] total collected items: ${collected.length}`);

    const meta = await fetchAndSave(collected, semanticMap.intent_extraction);

    const existingMetadata =
      (await readJson<FetchedAsset[]>(METADATA_PATH)) ?? [];

    const combinedMetadata = [...existingMetadata, ...meta];

    semanticMap.fetched_assets = [...(semanticMap.fetched_assets ?? []), ...meta];

    await writeJson(METADATA_PATH, combinedMetadata);
    await writeJson(SEMANTIC_MAP_PATH, semanticMap);

    console.log(
      `[done] saved ${meta.length} assets. See ${path.relative(
        process.cwd(),
        METADATA_PATH
      )} and updated semantic_map.json`
    );

    const endTime = Date.now();
    const latency = endTime - startTime;

    const uniqueProviders = new Set(meta.map(m => m.source)).size;
    const yieldRate = collected.length > 0 ? meta.length / collected.length : 0;

    if (!semanticMap.evaluation_metrics) {
      semanticMap.evaluation_metrics = {
        timestamp: new Date().toISOString(),
        total_latency_ms: 0,
        system_health_score: 0
      };
    }

    semanticMap.evaluation_metrics.stage3 = {
      latency_ms: latency,
      fetch_yield_rate: yieldRate,
      provider_diversity_count: uniqueProviders,
      search_success_rate: meta.length > 0 ? 1.0 : 0.0
    };

    await writeJson(SEMANTIC_MAP_PATH, semanticMap);

  } finally {
    await browser.close();
  }
}