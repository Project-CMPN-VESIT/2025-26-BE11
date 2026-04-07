import fs from "fs";
import path from "path";
import { EvaluationMetrics, SemanticMap } from "../types/semanticMap";

const DATA_DIR = path.join(process.cwd(), "src", "data");
const LOG_FILE = path.join(DATA_DIR, "experiments_log.csv");

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function logBenchmark(semanticMap: SemanticMap) {
    const metrics = semanticMap.evaluation_metrics;
    if (!metrics) return;

    const headers = [
        "timestamp",
        "prompt",
        "total_latency_ms",
        "system_health_score",
        "s1_latency",
        "s1_completeness",
        "s2_decision",
        "s2_confidence",
        "s3_yield_rate",
        "s3_diversity",
        "s4_precision_k",
        "s4_visual_diversity",
        "s4_best_match"
    ];

    // Create file with headers if it doesn't exist
    if (!fs.existsSync(LOG_FILE)) {
        fs.writeFileSync(LOG_FILE, headers.join(",") + "\n");
    }

    // Safe getter helper
    const s1 = metrics.stage1;
    const s2 = metrics.stage2;
    const s3 = metrics.stage3;
    const s4 = metrics.stage4;
    const decision = semanticMap.decision_reasoning?.final_decision || "unknown";

    const row = [
        metrics.timestamp,
        `"${semanticMap.user_prompt.replace(/"/g, '""')}"`, // Escape quotes
        metrics.total_latency_ms,
        metrics.system_health_score.toFixed(2),
        s1?.latency_ms ?? 0,
        s1?.completeness_score.toFixed(2) ?? 0,
        decision,
        s2?.decision_confidence.toFixed(2) ?? 0,
        s3?.fetch_yield_rate.toFixed(2) ?? 0,
        s3?.provider_diversity_count ?? 0,
        s4?.precision_at_k.toFixed(2) ?? 0,
        s4?.visual_diversity_score.toFixed(4) ?? 0,
        s4?.best_match_score.toFixed(4) ?? 0
    ];

    fs.appendFileSync(LOG_FILE, row.join(",") + "\n");
    console.log(`\n📝 Benchmark logged to ${LOG_FILE}`);
}
