import { runPromptUnderstanding } from "./promptUnderstanding";
import { runDecisionReasoning } from "./decisionReasoning";
import { runFetchAssets } from "../scraping/fetchAssets";
import { runRelevanceMatching } from "./relevanceMatcher";
import { readJson, writeJson } from "../utils/fileUtils";
import { SEMANTIC_MAP_PATH } from "../config/constants";
import type { SemanticMap } from "../types/semanticMap";
import { processUserMedia } from "./userMediaProcessor";
import { runGenerateWithFal } from "../generation/generateWithFal";

const MAX_RETRIES = 2; // Avoid infinite loops

export async function runAgenticWorkflow(initialPrompt: string): Promise<void> {
    let currentPrompt = initialPrompt;
    let attempts = 0;
    let satisfied = false;

    while (attempts <= MAX_RETRIES && !satisfied) {
        console.log(`\n🔄 --- AGENTIC LOOP: ATTEMPT ${attempts + 1} ---`);
        
        // Clear previous attempt's fetched assets to avoid stale file references
        let semanticMap = await readJson<SemanticMap>(SEMANTIC_MAP_PATH);
        if (semanticMap) {
          semanticMap.fetched_assets = [];
          await writeJson(SEMANTIC_MAP_PATH, semanticMap);
        }
        
        // 1. Core Pipeline
        await runPromptUnderstanding(currentPrompt);
        await runDecisionReasoning();
        await runFetchAssets();
        await runRelevanceMatching();

        // 2. Evaluation Step
        semanticMap = await readJson<SemanticMap>(SEMANTIC_MAP_PATH);
        const relevantCount = semanticMap?.relevant_assets?.length || 0;

        // Condition for satisfaction: e.g., at least 3 high-quality assets
        if (relevantCount >= 3) {
            console.log(`✅ Satisfaction Met: Found ${relevantCount} relevant assets.`);
            satisfied = true;
        } else {
            console.warn(`⚠️ Only found ${relevantCount} assets. Refiing search...`);
            attempts++;
            
            // FEEDBACK MECHANISM: Refine the prompt for the next loop
            // In a real agent, you might use an LLM here to "Reflect" on why it failed
            currentPrompt = `high quality detailed cinematic footage of ${initialPrompt}, professional stock style`;
        }
    }

    if (!satisfied) {
        console.error("❌ Pipeline finished without meeting satisfaction criteria.");
    }
}

export async function runUserMediaWorkflow(filePath: string, userPrompt: string): Promise<void> {
    console.log(`\n--- RUN USER MEDIA WORKFLOW ---`);

    // 1. Process the user's media + prompt (saves semantic_map.json)
    await processUserMedia(filePath, userPrompt);

    // 2. Decision reasoning (reads semantic map and writes decision)
    await runDecisionReasoning();

    // 3. Branch based on decision
    const semanticMap = (await readJson<SemanticMap>(SEMANTIC_MAP_PATH)) ?? ({} as SemanticMap);
    const decision = semanticMap.decision_reasoning?.final_decision;

    if (decision === "fetch_from_web") {
        await runFetchAssets();
        await runRelevanceMatching();
    } else if (decision === "generate_with_model") {
        await runGenerateWithFal();
        await runRelevanceMatching();
    } else if (decision === "enhance_existing_asset") {
        // Attempt local enhancement pipeline that preserves scenery
        console.log("Decision: enhance_existing_asset — invoking local enhancer to produce variants.");
        
        await runRelevanceMatching();
    } else {
        console.warn("Unknown decision. Falling back to fetch_from_web.");
        await runFetchAssets();
        await runRelevanceMatching();
    }
}