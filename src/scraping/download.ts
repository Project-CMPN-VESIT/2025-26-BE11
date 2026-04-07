import axios from "axios";
import fs from "fs";
import path from "path";
import { sha256Bytes } from "../utils/hashing";

const fsp = fs.promises;

/**
 * Minimum byte thresholds
 * - Coverr / preview videos are small
 * - Pixabay / Pexels often larger
 */
// byte thresholds per media type
const MIN_BYTES_DEFAULT = 5_000; // ~5 KB general fallback
const MIN_BYTES_AUDIO = 1_000; // allow very small audio previews
const MIN_BYTES_COVERR = 5_000;  // coverr-specific fallback

/**
 * Source-aware browser headers
 */
function getHeadersForSource(source: string) {
  const base = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,video/mp4,video/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
  };

  if (source === "pexels") {
    return { ...base, Referer: "https://www.pexels.com/" };
  }

  if (source === "coverr") {
    return { ...base, Referer: "https://coverr.co/" };
  }

  if (source === "pixabay") {
    return { ...base, Referer: "https://pixabay.com/" };
  }

  return base;
}

/**
 * Infer extension from content-type
 */
function inferExtension(contentType: string, fallback: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("video")) {
    if (ct.includes("webm")) return ".webm";
    return ".mp4";
  }
  if (ct.includes("image")) {
    if (ct.includes("png")) return ".png";
    if (ct.includes("webp")) return ".webp";
    return ".jpg";
  }
  if (ct.includes("audio")) {
    if (ct.includes("wav")) return ".wav";
    if (ct.includes("ogg")) return ".ogg";
    return ".mp3";
  }
  return fallback;
}

/**
 * MAIN DOWNLOAD FUNCTION
 */
export async function downloadToDir(
  url: string,
  toDir: string,
  preferredExt: string,
  source: string = "unknown"
): Promise<{
  filePath: string;
  content: Buffer;
  contentType: string;
  width: number;
  height: number;
  hash: string;
}> {
  if (url.startsWith("//")) {
    url = "https:" + url;
  }

  const headers = getHeadersForSource(source);

  // 🔹 Skip HEAD entirely for videos (many CDNs block HEAD)
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    headers,
    timeout: 60_000,
    maxRedirects: 10,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const content = Buffer.from(res.data);
  const contentType =
    (res.headers["content-type"] as string) || "";

  // 🔹 Determine minimum bytes threshold based on type
  let minBytes = MIN_BYTES_DEFAULT;
  if (contentType.includes("audio") || preferredExt === ".mp3" || preferredExt === ".wav") {
    minBytes = MIN_BYTES_AUDIO;
  }
  if (source === "coverr") {
    minBytes = Math.max(minBytes, MIN_BYTES_COVERR);
  }

  if (content.length < minBytes) {
    // instead of throwing, log a warning and still save small audio clips
    const msg = `Asset from ${source} rejected: ${content.length} bytes (< ${minBytes})`;
    if (contentType.includes("audio")) {
      console.warn(`[download warning] ${msg} – saving anyway because it's audio`);
    } else {
      throw new Error(msg);
    }
  }

  const hash = sha256Bytes(content);
  const ext = inferExtension(contentType, preferredExt);

  await fsp.mkdir(toDir, { recursive: true });

  // Sanitize source to remove path separators (/, \) to avoid nested directory creation
  const cleanSource = source
    .toLowerCase()
    .split(" ")[0]
    .replace(/[\/\\]/g, "-");
  const fileName = `${cleanSource}_${hash.slice(0, 12)}${ext}`;
  const filePath = path.join(toDir, fileName);

  if (!fs.existsSync(filePath)) {
    await fsp.writeFile(filePath, content);
  }

  // Width / height can be added later via ffprobe if needed
  const width = 0;
  const height = 0;

  return {
    filePath,
    content,
    contentType,
    width,
    height,
    hash,
  };
}
