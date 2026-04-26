# AutoGenie

A multimodal AI media assistant that combines prompt understanding, web scraping, model generation, relevance filtering, and asset classification.

## What this repo contains

- `frontend/` — Next.js UI for browsing and interacting with generated or fetched media assets.
- `typescript/` — core TypeScript pipeline and scraping logic for prompt processing, asset retrieval, generation, and scoring.
- `api.ts` — Node entrypoint for running the API workflow in development.
- `server.py` — MCP tool wrapper that launches the TypeScript pipeline and returns `semantic_map.json` results.
- `data/`, `scrape_assets/`, `temp_uploads/` — asset and metadata storage for scraped media, uploads, and semantic maps.

## Key features

- semantic prompt understanding and prompt refinement
- hybrid web scraping + model generation for images, audio, and video
- relevance matching and asset classification
- experiment logging and structured semantic map output
- Next.js frontend integrated with Supabase support

## Run locally

1. Install root dependencies:
   ```powershell
   npm install
   ```

2. Start the API/pipeline watcher:
   ```powershell
   npm run dev
   ```

3. Start the frontend app separately:
   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

4. Run the pipeline directly:
   ```powershell
   npm run pipeline
   ```

## Notes

- The pipeline uses environment variables from `typescript/.env`.
- `typescript/src/index.ts` is the orchestrator that runs prompt understanding, decision reasoning, asset retrieval, and relevance scoring.
- `frontend/` is a self-contained Next.js application and may require its own install step.
