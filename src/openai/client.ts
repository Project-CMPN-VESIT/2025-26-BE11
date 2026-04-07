// src/openai/client.ts
import OpenAI from "openai";
import { OPENAI_API_KEY } from "../config/env";

if (!OPENAI_API_KEY) {
  console.warn("[openai] No OPENAI_API_KEY found. Client will still construct but calls will fail.");
}

export const openaiClient = new OpenAI({
  apiKey: OPENAI_API_KEY,
});
