import axios from "axios";
import type { Browser, Page } from "puppeteer";
import { newPage, scrollLazy } from "./browser";
import { FREESOUND_API_KEY } from "../config/env";
import { ScrapedItem } from "./imageProviders";

const BASE_URL = "https://freesound.org/apiv2";

interface FreesoundResult {
  id: number;
  name: string;
  previews: { "preview-hq-mp3": string; "preview-hq-ogg": string };
  username: string;
  url: string; // page url
}

/**
 * Freesound API-based scraper (requires API key)
 * More reliable when API key is available
 */
export async function scrapeFreesoundAudio(
  query: string,
  limit: number
): Promise<ScrapedItem[]> {
  if (!FREESOUND_API_KEY) {
    return [];
  }

  const items: ScrapedItem[] = [];
  const searchUrl = `${BASE_URL}/search/text/`;

  try {
    const params = {
      query: query,
      token: FREESOUND_API_KEY,
      fields: "id,name,previews,username,url",
      page_size: limit,
      filter: "duration:[1 TO 60]",
      sort: "score",
    };

    const res = await axios.get(searchUrl, { params, timeout: 10000 });
    const results = res.data.results as FreesoundResult[];

    if (results) {
      for (const r of results) {
        const mp3 = r.previews["preview-hq-mp3"];
        if (!mp3) continue;

        items.push({
          type: "audio",
          source: "freesound",
          mediaUrl: mp3,
          pageUrl: r.url,
          alt: r.name,
          query: query,
        });
      }
    }
  } catch (err: any) {
    console.warn(`[freesound] API Error searching for '${query}':`, err.message);
  }

  return items;
}

/**
 * Freesound browser-based scraper (API key optional)
 * Uses Puppeteer to extract audio URLs without API dependency
 */
export async function scrapeFreesoundBrowserAudio(
  browser: Browser,
  query: string,
  limit: number
): Promise<ScrapedItem[]> {
  const page = await newPage(browser);

  try {
    const url = `https://freesound.org/search/?q=${encodeURIComponent(query)}&sort=relevance`;

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await scrollLazy(page);

    const items = await page.evaluate((lim) => {
      const results: { src: string; title: string; author: string }[] = [];

      // Freesound embeds audio players with data-mp3 attributes or sound links
      const players = document.querySelectorAll(
        "div.bw-player[data-mp3], audio[src], .player-container"
      );

      for (const el of players) {
        let src = (el as any).getAttribute("data-mp3") || (el as any).getAttribute("src");

        if (!src) {
          // Try to find audio source within the element
          const audioEl = el.querySelector("audio") as HTMLAudioElement;
          const sourceEl = el.querySelector("source") as HTMLSourceElement;
          src = audioEl?.src || sourceEl?.src;
        }

        if (src && (src.endsWith(".mp3") || src.endsWith(".ogg") || src.includes("freesound"))) {
          const title = (el as any).getAttribute("data-title") ||
            el.querySelector("a[title]")?.getAttribute("title") ||
            el.textContent?.substring(0, 50) || "Audio";

          const author = el.querySelector(".user-info")?.textContent || el.querySelector("a[href*='/people/']")?.textContent || "";

          results.push({
            src,
            title: title.trim(),
            author: author.trim(),
          });

          if (results.length >= lim) break;
        }
      }

      return results;
    }, limit);

    await page.close();

    return items.map((i) => ({
      type: "audio",
      source: "freesound",
      mediaUrl: i.src,
      alt: `${i.title}${i.author ? ` by ${i.author}` : ""}`,
      query: query,
    }));
  } catch (err: any) {
    console.error(`[freesound] Browser scraping error for '${query}':`, err.message);
    await page.close();
    return [];
  }
}