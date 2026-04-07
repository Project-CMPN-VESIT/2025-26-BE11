// src/scraping/imageProviders.ts
import type { Page } from "puppeteer";
import { scrollLazy } from "./browser";

export interface ScrapedItem {
  type: "image" | "video" | "audio";
  source: string;
  mediaUrl: string;
  pageUrl?: string;
  alt?: string;
  query: string;
}

/**
 * Filter to exclude common UI/Avatar keywords in URLs
 */
const isGarbage = (url: string): boolean => {
  const garbage = ["profile-", "avatar", "canva", "logo", "96x96", "32x32", "user-"];
  return garbage.some(kw => url.toLowerCase().includes(kw));
};

export async function scrapeUnsplashImages(
  page: Page,
  q: string,
  limit: number
): Promise<ScrapedItem[]> {
  const url = `https://unsplash.com/s/photos/${q.replace(/\s+/g, "-")}`;
  await page.goto(url, { waitUntil: "networkidle2" });
  await scrollLazy(page);

  const data = await page.evaluate((limitEval) => {
    const results: any[] = [];
    // Target only images with itemprop thumbnail, or within the main route container
    const imgs = Array.from(document.querySelectorAll('img[itemprop="thumbnailUrl"], figure img'));
    const seen = new Set<string>();

    for (const img of imgs) {
      if (results.length >= limitEval) break;
      const el = img as HTMLImageElement;

      // Filter by size and keyword
      if (el.width < 150) continue;
      const src = el.currentSrc || el.src;
      if (!src || src.includes('profile-') || src.includes('w=32')) continue;

      const key = src.split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);

      const link = el.closest("a[href*='/photos/']") as HTMLAnchorElement | null;
      results.push({ src, alt: el.alt || "", pageUrl: link ? link.href : "" });
    }
    return results;
  }, limit);

  return data.map(d => ({
    type: "image",
    source: "unsplash",
    mediaUrl: d.src,
    pageUrl: d.pageUrl,
    alt: d.alt,
    query: q,
  }));
}

export async function scrapePexelsImages(
  page: Page,
  q: string,
  limit: number
): Promise<ScrapedItem[]> {
  const url = `https://www.pexels.com/search/${encodeURIComponent(q)}/`;
  await page.goto(url, { waitUntil: "networkidle2" });
  await scrollLazy(page);

  const data = await page.evaluate((limitEval) => {
    const results: any[] = [];
    // Pexels search results are usually inside an 'article' or specific media-card
    const imgs = Array.from(document.querySelectorAll('article img, [data-testid="item-card"] img'));
    const seen = new Set<string>();

    for (const img of imgs) {
      if (results.length >= limitEval) break;
      const el = img as HTMLImageElement;

      const src = el.getAttribute("src") || el.getAttribute("data-src") || el.src;
      if (!src || src.includes('lib/canva') || src.includes('avatar') || el.width < 150) continue;

      const key = src.split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);

      const link = el.closest("a[href*='/photo/']") as HTMLAnchorElement | null;
      results.push({ src, alt: el.alt || "", pageUrl: link ? link.href : "" });
    }
    return results;
  }, limit);

  return data.map(d => ({
    type: "image",
    source: "pexels",
    mediaUrl: d.src,
    pageUrl: d.pageUrl,
    alt: d.alt,
    query: q,
  }));
}

export async function scrapePixabayImages(
  page: Page,
  q: string,
  limit: number
): Promise<ScrapedItem[]> {
  const url = `https://pixabay.com/images/search/${encodeURIComponent(q)}/`;
  await page.goto(url, { waitUntil: "networkidle2" });
  await scrollLazy(page);

  // Inside scrapePixabayImages evaluate block
  const data = await page.evaluate((limitEval) => {
    const results: any[] = [];

    // Specifically EXCLUDE the sponsored top bar
    const container = document.querySelector('[class*="results--"]');
    if (!container) return [];

    // Look for images that are NOT inside the sponsored/ad sections
    const imgs = Array.from(container.querySelectorAll('img')).filter(img => {
      return !img.closest('[class*="sponsored"]') && !img.closest('[class*="ad"]');
    });

    const seen = new Set<string>();
    for (const img of imgs) {
      if (results.length >= limitEval) break;
      const el = img as HTMLImageElement;

      // Use Pixabay's specific data attributes for high-res if available
      const src = el.getAttribute("src") || el.getAttribute("data-lazy") || el.src;
      if (!src || src.includes('/user/') || el.width < 150) continue;

      const key = src.split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);

      const link = el.closest("a") as HTMLAnchorElement | null;
      results.push({ src, alt: el.alt || "", pageUrl: link ? link.href : "" });
    }
    return results;
  }, limit);

  return data.map(d => ({
    type: "image",
    source: "pixabay",
    mediaUrl: d.src,
    pageUrl: d.pageUrl,
    alt: d.alt,
    query: q,
  }));
}