// src/config/constants.ts
import path from "path";

export const DEST_DIR = path.join(process.cwd(), "scrape_assets");
export const IMG_DIR = path.join(DEST_DIR, "images");
export const VID_DIR = path.join(DEST_DIR, "videos");
export const AUD_DIR = path.join(DEST_DIR, "audio");

export const METADATA_PATH = path.join(DEST_DIR, "metadata.json");
export const SEMANTIC_MAP_PATH = path.join(process.cwd(), "data", "semantic_map.json");

export const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export const HEADLESS: boolean = true;
export const MAX_QUERIES = 2;
export const MAX_PER_PROVIDER = 3;
export const MIN_PIXELS = 120 * 120; // filter tiny images
export const MIN_BYTES = 3000;       // filter tiny files for audio/video too
export const DETAIL_OPEN_LIMIT = 8;  // like in your Python code
