// src/pipeline/promptRefiner.ts

import { askPromptEngine } from "../openai/askPromptEngine";

type RefinementResult = {
  refinedPrompt: string;
  isComplete: boolean;
  modality?: "image" | "video" | "audio";
  count?: number;
  message?: string;
};

function detectMissingDetails(text: string): string[] {
  const lower = text.toLowerCase();
  const missing: string[] = [];

  // Check subject (very simple heuristic: at least one noun-like word)
  if (lower.split(" ").length < 2) {
    missing.push("main subject");
  }

  // Action detection (simple verb heuristic)
  if (!/\b(working|running|typing|walking|talking|flying|playing|sitting|standing)\b/.test(lower)) {
    missing.push("action (what is happening)");
  }

  // Scene/context
  if (!/\b(in|on|at|inside|outdoor|beach|office|city|room|forest|studio)\b/.test(lower)) {
    missing.push("scene or location");
  }

  return missing;
}
function normalizeInput(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function detectModality(text: string): "image" | "video" | "audio" | null {
  const lower = text.toLowerCase();

  if (/\b(image|images|photo|photos|picture|pictures)\b/.test(lower)) {
    return "image";
  }
  if (/\b(video|videos|footage|clip|clips)\b/.test(lower)) {
    return "video";
  }
  if (/\b(audio|sound|music|track|voiceover)\b/.test(lower)) {
    return "audio";
  }

  return null;
}

function detectCount(text: string): number | null {
  const match = text.match(/\b\d+\b/);
  if (match) {
    return parseInt(match[0], 10);
  }

  return null; // do NOT assume 1 automatically
}

export async function refineUserPrompt(
  input: string
): Promise<RefinementResult> {
  const cleaned = normalizeInput(input);

  // 1. Strict Regex Trap: Force clarification if modality is not organically present
  // This solves the issue where the LLM "assumes" image silently.
  const explicitModality = detectModality(cleaned);
  if (!explicitModality) {
    console.log("No explicit modality detected natively. Triggering clarification bounce.");
    return {
      refinedPrompt: cleaned,
      isComplete: false,
      message: "Could you specify if you want me to generate an **Image**, **Video**, or **Audio** for that?"
    };
  }

  console.log("LLM intelligent refinement in progress...");

  const checkPrompt = `
Analyze this user request for media generation:

"${cleaned}"

Your goal is to refine and optimize this prompt.
If the prompt is physically impossible, paradoxical, or vague (e.g., "a dog walking on two legs" without clarifying "anthropomorphic" or "hind legs"), enhance it with clear, descriptive terms to make it logical and actionable for an AI generator. Preserve the core intent. If it's already clear, just standardize it.

Return ONLY valid JSON.

{
  "isComplete": true,
  "refinedPrompt": "The improved, detailed prompt. Must include the count and modality if known.",
  "modality": "image|video|audio",
  "count": 1,
  "message": ""
}

If the request is so vague that you cannot guess the user's intent, or if modality/count are missing and cannot be assumed:
{
  "isComplete": false,
  "refinedPrompt": "${cleaned}",
  "modality": "image|video|audio",
  "count": 1,
  "message": "A helpful question asking the user for clarification about the vague/impossible parts, modality, or count."
}
`.trim();

  const response = await askPromptEngine(checkPrompt);

  try {
    const sanitizedResponse = response.replace(/\`\`\`json\n?|\`\`\`/g, "").trim();
    const parsed = JSON.parse(sanitizedResponse);

    // Ensure modality is one of the valid types if present
    if (parsed.modality && !["image", "video", "audio"].includes(parsed.modality)) {
      parsed.modality = detectModality(cleaned) || "image";
    }

    if (!parsed.count || isNaN(parsed.count)) {
      parsed.count = detectCount(cleaned) || 1;
    }

    console.log("LLM refinement result:", parsed);

    return parsed as RefinementResult;
  } catch (e) {
    console.error("Failed to parse LLM JSON. Returning fallback.");

    return {
      refinedPrompt: cleaned,
      isComplete: false,
      message: "Please specify whether you need an image, video, or audio.",
    };
  }
}