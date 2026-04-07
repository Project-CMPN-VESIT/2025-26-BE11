// src/openai/askDecisionEngine.ts
import { openaiClient } from "./client";

export async function askDecisionEngine(
  prompt: string,
  model = "gpt-4o-mini"
): Promise<string> {
  const completion = await openaiClient.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "You are an AI decision reasoning module for a media-fetching system. Always return your response in valid JSON format.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    // --- Enable JSON Mode ---
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_tokens: 800,
  });

  return completion.choices[0]?.message?.content ?? "";
}