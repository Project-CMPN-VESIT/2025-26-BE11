// src/scraping/audioProviders.ts
import type { Browser, Page } from "puppeteer";
import { scrollLazy, newPage } from "./browser";
import type { ScrapedItem } from "./imageProviders";

/**
 * Mixkit Audio Scraper — finds free sound effects & music
 */

async function acceptCookiesIfPresent(page: Page) {
  try {
    // Wait briefly for cookie modal
    await page.waitForSelector("button", { timeout: 5000 });

    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const acceptBtn = buttons.find(btn =>
        btn.textContent?.toLowerCase().includes("accept")
      );
      if (acceptBtn) {
        (acceptBtn as HTMLElement).click();
        return true;
      }
      return false;
    });

    if (clicked) {
      console.log("[cookies] accepted");
      await new Promise(res => setTimeout(res, 1500)); // allow DOM to unlock
    }
  } catch {
    // no cookie modal — safe to ignore
  }
}

export async function scrapeMixkitAudio(
  browser: Browser,
  q: string,
  limit: number
): Promise<ScrapedItem[]> {
  const page = await newPage(browser);
  const url = `https://elements.envato.com/sound-effects/${encodeURIComponent(
    q
  )}/?type=sound-effects`;

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await acceptCookiesIfPresent(page);
  await scrollLazy(page);

  const previews = await page.evaluate((lim) => {
    const items: string[] = [];
    const nodes = document.querySelectorAll(
      '[data-testid="audio-waveform"][data-test-waveform-url]'
    );

    for (const el of nodes) {
      const src = el.getAttribute("data-test-waveform-url");
      if (src && src.endsWith(".mp3")) {
        items.push(src);
      }
      if (items.length >= lim) break;
    }
    return items;
  }, limit);

  await page.close();

  return previews.map((src) => ({
    type: "audio",
    source: "mixkit",
    mediaUrl: src,
    query: q,
  }));
}

async function capturePixabayAudioRequests(
  page: Page,
  timeout = 12000
): Promise<string[]> {
  const urls = new Set<string>();

  const onResponse = (res: any) => {
    const url = res.url();
    if (
      url.includes("cdn.pixabay.com/audio") &&
      /\.(mp3|wav|ogg)(\?|$)/.test(url)
    ) {
      urls.add(url);
    }
  };

  page.on("response", onResponse);

  // Wait using Node timer (NOT page.waitForTimeout)
  await new Promise(resolve => setTimeout(resolve, timeout));

  page.off("response", onResponse);
  return [...urls];
}

/**
 * Trigger at least one audio play on Pixabay
 * (Pixabay will NOT fetch audio unless play is clicked)
 */
/**
 * Refined Trigger: Targets the play button more accurately
 */
async function triggerPixabayPlay(page: Page) {
  await page.evaluate(() => {
    // 1. Find all buttons that look like play buttons
    const buttons = Array.from(document.querySelectorAll('button[aria-label]'));
    
    // 2. Find the first one that mentions "play" (case insensitive)
    const playBtn = buttons.find(btn => 
      btn.getAttribute('aria-label')?.toLowerCase().includes('play')
    ) as HTMLElement;

    if (playBtn) {
      playBtn.scrollIntoView();
      playBtn.click();
    } else {
      // Fallback: Click the first 'audioRow' container if button search fails
      const fallbackRow = document.querySelector('[class*="audioRow"]') as HTMLElement;
      fallbackRow?.click();
    }
  });
}

/**
 * Pixabay Audio Scraper
 */
export async function scrapePixabayAudio(
  browser: Browser,
  q: string,
  limit: number
): Promise<ScrapedItem[]> {
  const page = await newPage(browser);

  // Set a User-Agent to avoid being flagged as a bot immediately
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const url = `https://pixabay.com/music/search/${encodeURIComponent(q)}/`;

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Pixabay sometimes has an overlay or "Accept Cookies" that blocks clicks
    await acceptCookiesIfPresent(page); 

    // Start listening for responses
    const audioUrls: string[] = [];
    page.on('response', (response) => {
      const url = response.url();
      // Pixabay audio usually comes from cdn.pixabay.com and contains .mp3
      if (url.includes("cdn.pixabay.com/audio") && url.includes(".mp3")) {
        audioUrls.push(url);
      }
    });

    // 1. Scroll to trigger lazy loading of the list
    await scrollLazy(page);

    // 2. Click Play to force the browser to fetch the MP3 stream
    await triggerPixabayPlay(page);

    // 3. Wait a few seconds for the network requests to fire
    await new Promise(res => setTimeout(res, 5000));

    await page.close();

    // Remove duplicates and return
    const uniqueUrls = [...new Set(audioUrls)];
    return uniqueUrls.slice(0, limit).map((src) => ({
      type: "audio",
      source: "pixabay",
      mediaUrl: src,
      query: q,
    }));

  } catch (error) {
    console.error("Pixabay Scraping Error:", error);
    await page.close();
    return [];
  }
}/**
 * Freesound Preview Scraper — retrieves preview sounds (no login)
 */
export async function scrapeFreesoundPreviews(
  browser: Browser,
  q: string,
  limit: number
): Promise<ScrapedItem[]> {
  const page = await newPage(browser);
  const url = `https://freesound.org/search/?q=${encodeURIComponent(q)}`;

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await scrollLazy(page);

  const items = await page.evaluate((lim) => {
    const results: { src: string; title: string }[] = [];

    const players = document.querySelectorAll(
      "div.bw-player[data-mp3]"
    );

    for (const el of players) {
      const src = el.getAttribute("data-mp3");
      const title = el.getAttribute("data-title") || "";
      if (src && src.endsWith(".mp3")) {
        results.push({ src, title });
      }
      if (results.length >= lim) break;
    }

    return results;
  }, limit);

  await page.close();

  return items.map((i) => ({
    type: "audio",
    source: "freesound",
    mediaUrl: i.src,
    alt: i.title,
    query: q,
  }));
}
