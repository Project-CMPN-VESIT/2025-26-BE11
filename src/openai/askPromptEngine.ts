// src/openai/askPromptEngine.ts
import { openaiClient } from "./client";
import * as fs from "fs";

export async function askPromptEngine(
  prompt: string,
  mediaPath?: string,
  mediaType?: "image" | "video" | "audio",
  model = "gpt-4o" // Note: Upgrade to gpt-4o for multimodality
): Promise<string> {

  const messages: any[] = [
    {
      role: "system",
      content: "You are a reasoning engine that analyzes creative multimodal prompts.",
    }
  ];

  let contentArray: any[] = [{ type: "text", text: prompt }];

  if (mediaPath && fs.existsSync(mediaPath)) {
    try {
      if (mediaType === "image") {
        const base64Image = fs.readFileSync(mediaPath, { encoding: "base64" });
        contentArray.push({
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${base64Image}`
          }
        });
      } else if (mediaType === "audio") {
        // Simple shim: Instruct the LLM that an audio file is attached.
        // For true native audio streaming to GPT-4o, specific beta APIs are used. 
        // We simulate the context here or could transcribe first.
        contentArray.push({
          type: "text",
          text: "[SYSTEM: The user attached an audio file. Assume it provides tone or atmospheric context aligned with the text prompt]"
        });
      } else if (mediaType === "video") {
        // Similarly for video, production systems extract a few frames as base64 images here.
        // Since we don't have FFmpeg frame extraction wired up specifically for prompt parsing yet in this script, 
        // we simulate the context provided.
        contentArray.push({
          type: "text",
          text: "[SYSTEM: The user attached a video file. Assume it provides motion and subject context aligned with the text prompt]"
        });
      }
    } catch (e) {
      console.error("Failed to read media file for prompt parsing:", e);
    }
  }

  messages.push({
    role: "user",
    content: contentArray
  });

  const completion = await openaiClient.chat.completions.create({
    model,
    messages,
    temperature: 0.4,
    max_tokens: 700,
  });

  return completion.choices[0]?.message?.content ?? "";
}
