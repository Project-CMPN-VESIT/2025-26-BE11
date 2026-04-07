import { openaiClient } from "./client";

export async function generateNegativeLabels(prompt: string): Promise<string[]> {
  const systemPrompt = `
    You are a vision-language expert. Given a user's image search prompt, 
    generate two "partial-match" negative labels.
    - Negative 1: The primary subject is present, but the context/setting is missing.
    - Negative 2: The context/setting is present, but the primary subject is missing.
    
    Example for "musician with crowd in street":
    ["a solo musician with no crowd", "a crowd of people with no musician"]
    
    Return exactly a JSON array of 2 strings.
  `;

  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content || "{}";
    const parsed = JSON.parse(content);
    // Support formats like { "negatives": [...] } or { "labels": [...] }
    return Object.values(parsed)[0] as string[];
  } catch (err) {
    console.error("Failed to generate negative labels, using defaults.");
    return ["unrelated subject", "different context"];
  }
}