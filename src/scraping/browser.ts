// src/scraping/browser.ts
import puppeteer, { Browser, Page } from "puppeteer";
import { HEADLESS, USER_AGENT } from "../config/constants";

export async function createBrowser(): Promise<Browser> {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      `--user-agent=${USER_AGENT}`,
    ],
  });

  return browser;
}

export async function newPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  page.setDefaultNavigationTimeout(60000);
  return page;
}

// Simple sleep helper using setTimeout
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Close browser with timeout to prevent hanging
 * If close hangs for more than timeoutMs, force kill the process
 */
export async function closeBrowserSafely(
  browser: Browser,
  timeoutMs: number = 5000
): Promise<void> {
  try {
    await Promise.race([
      browser.close().catch((err) => {
        console.warn(`[browser] close() error: ${(err as any)?.message || err}`);
      }),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          console.warn(`[browser] close() timed out after ${timeoutMs}ms — forceKilling browser process...`);
          resolve();
        }, timeoutMs)
      ),
    ]);

    // If we got here and the browser is still alive, try to force kill it
    try {
      const browserProcess = (browser as any).process?.();
      if (browserProcess) {
        browserProcess.kill();
        console.log(`[browser] Browser process killed (PID: ${browserProcess.pid})`);
      }
    } catch (e) {
      // Process already killed, that's fine
    }
  } catch (err) {
    console.warn(`[browser] Unexpected error during close: ${(err as any)?.message || err}`);
  }
}


export async function scrollLazy(
  page: Page,
  pause = 1300,
  maxScrolls = 35
): Promise<void> {
  let lastHeight: number;
  try {
    lastHeight = (await page.evaluate("document.body.scrollHeight")) as number;
  } catch {
    // Page navigated away before we could read the height — bail silently
    return;
  }

  for (let i = 0; i < maxScrolls; i++) {
    try {
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight);");
      await sleep(pause);

      const newHeight = (await page.evaluate(
        "document.body.scrollHeight"
      )) as number;

      if (newHeight === lastHeight) {
        await sleep(pause);
        const newHeight2 = (await page.evaluate(
          "document.body.scrollHeight"
        )) as number;
        if (newHeight2 === lastHeight) break;
      }

      lastHeight = newHeight;
    } catch (err: any) {
      // "Execution context was destroyed" means the page navigated away
      // (e.g. Unsplash bot-detection, login wall, or redirect).
      // Bail gracefully — whatever content is already on the page will be scraped.
      const msg: string = err?.message ?? "";
      if (
        msg.includes("Execution context was destroyed") ||
        msg.includes("Navigation") ||
        msg.includes("detached")
      ) {
        console.warn(`[scrollLazy] Page navigated away during scroll (scroll ${i + 1}/${maxScrolls}). Stopping early — will use content loaded so far.`);
      } else {
        console.warn(`[scrollLazy] Unexpected error during scroll: ${msg}`);
      }
      break;
    }
  }
}
