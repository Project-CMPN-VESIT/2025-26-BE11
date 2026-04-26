import path from "path";
import { runUserMediaWorkflow } from "../src/pipeline/orchestrator";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: ts-node scripts/runUserMedia.ts <filePath> [prompt]");
    process.exit(1);
  }

  const filePath = path.resolve(args[0]);
  const prompt = args.slice(1).join(" ") || "Please enhance this asset to a cinematic professional style.";

  console.log("Running user media workflow for:", filePath);
  console.log("Prompt:", prompt);

  try {
    await runUserMediaWorkflow(filePath, prompt);
    console.log("Workflow finished.");
  } catch (err) {
    console.error("Workflow error:", err);
    process.exit(1);
  }
}

void main();
