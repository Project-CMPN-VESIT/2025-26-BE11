// src/config/env.ts
import dotenv from "dotenv";

dotenv.config();

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
export const FREESOUND_API_KEY = process.env.FREESOUND_API_KEY ?? "";

if (!OPENAI_API_KEY) {
  console.warn(
    "[env] WARNING: OPENAI_API_KEY is not set. LLM calls will fail until you add it to .env"
  );
}
if (!FREESOUND_API_KEY) console.warn("[env] WARNING: FREESOUND_API_KEY is missing.");