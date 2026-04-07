import type { Browser, Page } from "puppeteer";
import { scrollLazy, newPage } from "./browser";
import type { ScrapedItem } from "./imageProviders";
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Helper to handle navigation with modern headers to avoid bot detection
async function safeGoto(page: Page, url: string) {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
}

/**
 * PIXABAY - Structure: <a> tags with href containing "/videos/"
 * Detail: High-res source inside <video> or <source> tags.
 */

// Add the stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

export async function scrapePixabayVideos(browser: any, q: string, limit: number): Promise<ScrapedItem[]> {
  // Use a fresh page from the stealth-wrapped puppeteer
  const page = await browser.newPage();
  
  // Set a real-world User Agent to match your screenshot environment
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const url = `https://pixabay.com/videos/search/${encodeURIComponent(q)}/`;
  const items: ScrapedItem[] = [];

  try {
    // Wait until network is idle so dynamic items load
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    
    // Mimic human behavior by scrolling slowly
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve(true);
          }
        }, 100);
      });
    });

    // TARGET: All <a> tags that link to a video detail page (semantic search)
    // This ignores the volatile classes like "videoContainer--xiMEN"
    const links = await page.$$eval("a[href*='/videos/']:not([href='/videos/'])", (anchors: any, lim: number) => {
      return anchors
        .map((a: HTMLAnchorElement) => a.href)
        .filter((href: string) => !href.includes('/search/')) // Filter out search breadcrumbs
        .slice(0, lim);
    }, limit);

    for (const href of links) {
      if (items.length >= limit) break;
      const detailPage = await browser.newPage();
      try {
        await detailPage.goto(href, { waitUntil: "networkidle2", timeout: 30000 });
        
        // Wait for the actual <video> tag or <source> to appear
        await detailPage.waitForSelector("video", { timeout: 10000 });

        const mediaUrl = await detailPage.evaluate(() => {
          const video = document.querySelector("video");
          // Check for high-res source first, then fallback to video.src
          const source = video?.querySelector("source")?.src || video?.src;
          return (source && source.startsWith('http')) ? source : null;
        });

        if (mediaUrl) {
          items.push({ type: "video", source: "pixabay", mediaUrl, pageUrl: href, query: q });
        }
      } catch (err) {
        console.warn(`[pixabay] Failed to resolve media on: ${href}`);
      } finally {
        await detailPage.close();
      }
    }
  } finally {
    await page.close();
  }
  return items;
}


export async function scrapePexelsVideos(
  browser: Browser,
  q: string,
  limit: number
): Promise<ScrapedItem[]> {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  );

  const url = `https://www.pexels.com/search/videos/${encodeURIComponent(q)}/`;
  const items: ScrapedItem[] = [];

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  // Scroll to load lazy videos
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let total = 0;
      const step = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total > document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });

  const videos = await page.$$eval(
    'video[src^="https://videos.pexels.com/video-files/"]',
    (vs, lim) =>
      vs
        .map(v => (v as HTMLVideoElement).src)
        .filter(src => src.endsWith(".mp4"))
        .slice(0, lim),
    limit
  );

  for (const mediaUrl of videos) {
    items.push({
      type: "video",
      source: "pexels",
      mediaUrl,
      pageUrl: url,
      query: q,
    });
  }

  await page.close();
  return items;
}

export async function scrapeCoverrVideos(
  browser: Browser,
  q: string,
  limit: number
): Promise<ScrapedItem[]> {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  );

  const url = `https://coverr.co/s?q=${encodeURIComponent(q)}`;
  const items: ScrapedItem[] = [];

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await scrollLazy(page);

    // 1. Extract links to the actual video detail pages instead of raw video tags
    // Coverr search results use <a> tags with hrefs starting with "/videos/"
    const videoDetailLinks = await page.$$eval('a[href^="/videos/"]', (anchors, lim) => {
      return Array.from(new Set(anchors.map(a => (a as HTMLAnchorElement).href)))
        .slice(0, lim);
    }, limit);

    for (const detailUrl of videoDetailLinks) {
      if (items.length >= limit) break;
      
      const detailPage = await browser.newPage();
      try {
        await detailPage.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36");
        await detailPage.goto(detailUrl, { waitUntil: "networkidle2", timeout: 30000 });

        // 2. Wait for the video or source tag to hydrate
        await detailPage.waitForSelector("video", { timeout: 10000 });

        const mediaUrl = await detailPage.evaluate(() => {
          const video = document.querySelector("video");
          if (!video) return null;

          // Target the source tag specifically as Coverr uses it for high-res
          const source = video.querySelector('source[type="video/mp4"]') as HTMLSourceElement;
          const finalSrc = source?.src || video.src;

          return (finalSrc && finalSrc.startsWith('http')) ? finalSrc : null;
        });

        if (mediaUrl) {
          items.push({
            type: "video",
            source: "coverr",
            mediaUrl,
            pageUrl: detailUrl,
            query: q,
          });
        }
      } catch (err) {
        console.warn(`[coverr] Failed to extract from detail page: ${detailUrl}`);
      } finally {
        await detailPage.close();
      }
    }
  } finally {
    await page.close();
  }
  return items;
}