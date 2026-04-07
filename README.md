## Architecture

```
User Prompt Input
    ↓
┌─────────────────────────────────────────────────────┐
│  STAGE 1: PROMPT UNDERSTANDING                      │
│  ✓ Intent Extraction (modality, domain, subject)   │
│  ✓ Realism & Abstractness Scoring                  │
│  ✓ Feasibility Judgement                           │
│  Output: Semantic Map (JSON)                        │
└─────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────┐
│  STAGE 2: DECISION REASONING                        │
│  ✓ Cost & Latency Estimation                       │
│  ✓ Fetch vs Generate Decision Logic                │
│  ✓ Confidence Scoring                              │
│  Decision: "fetch_from_web" | "generate_with_model"│
│           | "hybrid_fetch_and_enhance"             │
└─────────────────────────────────────────────────────┘
    ↓
┌──────────────────────────────┬──────────────────────┐
│  STAGE 3a: FETCH PATH        │ STAGE 3b: GENERATE   │
│  ✓ Query Building            │ PATH                 │
│  ✓ Multi-Source Scraping     │ ✓ Image Generation   │
│  ✓ Media Download            │ ✓ Video Generation   │
│  ✓ Metadata Extraction       │ (FAL.ai, OpenAI)     │
└──────────────────────────────┴──────────────────────┘
    ↓
┌─────────────────────────────────────────────────────┐
│  STAGE 4: RELEVANCE MATCHING                        │
│  ✓ CLIP Model Scoring (Vision-Language)            │
│  ✓ Metadata Matching                               │
│  ✓ Asset Filtering & Ranking                       │
│  Output: Ranked Relevant Assets                     │
└─────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────┐
│  STAGE 5: ASSET CLASSIFICATION & EVALUATION         │
│  ✓ Technical Metadata Extraction                    │
│  ✓ Visual Semantics via OpenAI                      │
│  ✓ Color & Scene Analysis                           │
│  ✓ Evaluation Metrics & Health Scoring              │
└─────────────────────────────────────────────────────┘
    ↓
Final Output: Curated Assets/Generated Media
```

---

## Pipeline Stages

*Recent updates include a pre‑stage prompt refinement loop, a new asset classification & evaluation phase, and enhanced metrics logging for experimental analysis.*


### **Stage 1: Prompt Understanding & Refinement**

Analyzes the user's natural language input and extracts structured information.  A lightweight refinement loop runs before the main pipeline to ensure the prompt is sufficiently detailed and to collect any missing parameters (count, modality, etc.) via `promptRefiner.ts`.

**Components:**
- `promptUnderstanding.ts` - Main orchestration
- `promptRefiner.ts` - Interactive prompt clarification
- `askPromptEngine.ts` - OpenAI API interface

**Processing Steps:**

0. **Prompt Refinement (pre-stage)**
   - Helmer interactively queries the user until the prompt contains required details
   - Populates requested count and modality
   - Ensures the pipeline starts with a clear, high‑quality prompt

1. **Intent Extraction**
   - Identifies modality (image, video, audio)
   - Extracts domain (natural, artistic, conceptual, surreal)
   - Determines primary subject and context/scene
   - Captures style adjectives (mood, tone modifiers)

2. **Realism & Abstractness Scoring**
   - Subject‑Context Relationship analysis (0.0‑1.0)
   - Modifier abstractness evaluation
   - Domain knowledge assessment
   - Outputs: `realism_score` and `abstractness_score`

3. **Feasibility Judgement**
   - Determines feasibility label (feasible, partially_feasible, fantasy)
   - Creative potential scoring (0.0‑1.0)
   - Realism overall assessment

**Output:** `semantic_map.json` containing all extracted data

---

### **Stage 2: Decision Reasoning**  
*(unchanged but left for clarity)*

Uses semantic map data to decide the optimal content acquisition strategy.

**Components:**
- `decisionReasoning.ts` - Main orchestration
- `askDecisionEngine.ts` - OpenAI API interface

**Decision Logic:**

- **Contextual Reasoning:** Analyzes realism, abstractness, feasibility, and creative potential
- **Cost Estimation:** Estimates computational resources for both fetch and generate approaches
- **Latency Estimation:** Predicts time requirements (low/medium/high)
- **Final Decision:** Selects optimal strategy with confidence score

**Output:** Decision object with reasoning trace and final choice

---

### **Stage 3a: Asset Fetching Path**  
*(unchanged but left for clarity)*

Multi-source web scraping and media download pipeline.

**Components:**
- `fetchAssets.ts` - Orchestration
- `queryBuilder.ts` - Search query optimization
- `imageProviders.ts` - Scrapes Unsplash, Pexels, Pixabay
- `videoProviders.ts` - Scrapes Pixabay, Pexels videos
- `audioProviders.ts` - Scrapes Mixkit sounds
- `freeSoundProvider.ts` - FreeSound API integration
- `browser.ts` - Puppeteer browser automation
- `download.ts` - Media file download & storage
- `modalityRouting.ts` - Detects required media types

**Features:**
- Intelligent query building based on intent
- Parallel scraping from multiple providers
- Duplicate detection using SHA256 hashing
- Metadata extraction (alt text, source, dimensions)
- Configurable per-provider limits (default: 10 items)

**Output:** Metadata JSON with downloaded assets in `scrape_assets/` directories

---

### **Stage 3b: Generation Path**  
*(unchanged but left for clarity)*

Synthetic content generation using AI models.

**Components:**
- `generateWithFal.ts` - FAL.ai model orchestration
- `detectModality()` - Routes to appropriate generator

**Supported Models:**
- **Image:** FLUX.1/2 dev (via FAL.ai)
- **Video:** Kling, HailuoAI, Minimax (via FAL.ai)
- **Fallback:** OpenAI DALL-E 3 for images

**Features:**
- Prompt enhancement using intent extraction
- Automatic modality detection
- Async API calls with result polling
- Error handling and retry logic
- Downloads generated assets locally

---

### **Stage 4: Relevance Matching**

Scores fetched assets against the user prompt for relevance.

*(This step remains unchanged but is now followed by an additional classification stage.)
**Components:**
- `relevanceMatcher.ts` - Main orchestration
- Uses CLIP model (Xenova/clip-vit-base-patch32)
- Video frame extraction via FFmpeg
- NLP-based subject extraction

**Scoring Strategy:**

1. **CLIP Vision-Language Model Scoring**
   - Zero-shot image classification
   - Extracts visual features aligned with text prompts
   - Returns similarity scores (0.0-1.0)

2. **Metadata Matching**
   - NLP-based subject extraction (nouns)
   - Matches subjects in alt text, filenames, sources
   - Metadata score: `matches / total_subjects`

3. **Filtering & Ranking**
   - Minimum score threshold: 0.21
   - Creates `relevant_assets/` directory
   - Organizes by media type (images, videos, audio)

**Output:** Filtered and ranked asset metadata

---

### **Stage 5: Asset Classification & Evaluation**

Enriches each candidate asset with technical and semantic metadata, then computes evaluation metrics that drive pipeline health reporting.

**Components:**
- `assetClassifier.ts` - Main orchestration
- `ColorThief` for dominant color extraction
- OpenAI vision semantics for scene understanding
- FFprobe/FFmpeg for technical probes

**Processing Steps:**
1. **Technical Probe** – dimensions, codec, aspect ratio, orientation, duration, size
2. **Visual Semantics** – call OpenAI to describe scenes/activities/tags
3. **Color & Scene Analysis** – dominant color, mood, etc.
4. **Metrics Logging** – latency per stage, precision@k, decision confidence
5. **Health Score** – weighted combination of completeness, confidence, precision

**Output:** Updated `semantic_map.json` with classification info and new metrics

---

---

## Project Structure

```
AutoGenie-Video-Gen-Platform/
├── README.md                          # This file
│
├── TYPESCRIPT/                        # Main TypeScript application
│   ├── package.json                   # Dependencies & scripts
│   ├── tsconfig.json                  # TypeScript configuration
│   │
│   ├── src/
│   │   ├── index.ts                   # Entry point (main pipeline)
│   │   │
│   │   ├── config/
│   │   │   ├── constants.ts           # Path & configuration constants
│   │   │   └── env.ts                 # Environment variable handling
│   │   │
│   │   ├── pipeline/                  # Core processing stages
│   │   │   ├── promptUnderstanding.ts # Stage 1: Intent extraction & refinement
│   │   │   ├── promptRefiner.ts       # User prompt clarification loop
│   │   │   ├── decisionReasoning.ts   # Stage 2: Fetch vs generate
│   │   │   ├── modalityRouting.ts     # Determines media type
│   │   │   ├── relevanceMatcher.ts    # Stage 4: Asset scoring
│   │   │   └── assetClassifier.ts     # Stage 5: Classification & metrics

│   │   │
│   │   ├── scraping/                  # Web scraping & downloading
│   │   │   ├── fetchAssets.ts         # Orchestration
│   │   │   ├── queryBuilder.ts        # Search query optimization
│   │   │   ├── browser.ts             # Puppeteer wrapper
│   │   │   ├── imageProviders.ts      # Unsplash, Pexels, Pixabay
│   │   │   ├── videoProviders.ts      # Video source scrapers
│   │   │   ├── audioProviders.ts      # Mixkit, FreeSound
│   │   │   ├── freeSoundProvider.ts   # FreeSound API
│   │   │   └── download.ts            # File download & storage
│   │   │
│   │   ├── generation/
│   │   │   └── generateWithFal.ts     # FAL.ai model integration
│   │   │
│   │   ├── openai/                    # OpenAI API interfaces
│   │   │   ├── askPromptEngine.ts     # Prompt understanding calls
│   │   │   ├── askDecisionEngine.ts   # Decision reasoning calls
│   │   │   └── client.ts              # OpenAI client setup
│   │   │
│   │   ├── types/
│   │   │   └── semanticMap.ts         # TypeScript interfaces
│   │   │
│   │   └── utils/
│   │       ├── fileUtils.ts           # JSON I/O, directory creation
│   │       ├── hashing.ts             # SHA256 duplicate detection
│   │       └── logging.ts             # Structured logging
│   │
│   ├── data/
│   │   └── semantic_map.json          # Generated semantic data
│   │
│   ├── tests/                         # Unit/integration tests (currently empty)
│   │
│   └── scrape_assets/                 # Downloaded media storage
│       ├── metadata.json              # Asset metadata
│       ├── images/                    # Downloaded images
│       ├── videos/                    # Downloaded videos
│       └── audio/                     # Downloaded audio
│
└── PYTHON/                            # Research & experimentation
    ├── Sprint1.ipynb                  # Initial research notebook
    ├── Multiple similar queries.ipynb # Query variation studies
    ├── Query expanded.ipynb           # Prompt expansion techniques
    │
    ├── Media_fetch_Algo/
    │   ├── media_fetch.ipynb          # Asset fetching research
    │   ├── web_scraping.ipynb         # Scraping techniques
    │   └── semantic_map.json          # Sample semantic data
    │
    └── VLM/                           # Vision-Language Model research
        ├── ViT-L-14.ipynb             # OpenCLIP ViT-L-14 experiments
        ├── OpenClip.ipynb             # General OpenCLIP workflows
        ├── ALIGN.ipynb                # ALIGN model experiments
        ├── Ensemble.ipynb             # Model fusion techniques
        └── semantic_map.json          # Sample data
```

---

## Technologies & Models

### **Core Technologies**

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Language** | TypeScript/Node.js | Backend orchestration |
| **LLMs** | OpenAI GPT-4/3.5 | Intent extraction, reasoning |
| **Generation** | FAL.ai APIs | Synthetic content creation |
| **Vision-Language** | CLIP (Xenova) | Asset relevance scoring |
| **Browser Automation** | Puppeteer | Web scraping |
| **Media Processing** | FFmpeg, Sharp | Video/image manipulation |
| **APIs** | Multiple (Unsplash, Pexels, etc.) | Media sourcing |
| **Classification** | OpenAI Vision, FFprobe, ColorThief | Asset metadata & semantics |

### **Dependency Stack**

```json
{
  "dependencies": {
    "@fal-ai/client": "^1.7.2",           // FAL.ai client
    "@xenova/transformers": "^2.17.2",    // CLIP, HuggingFace models
    "axios": "^1.13.2",                   // HTTP requests
    "compromise": "^14.14.4",             // NLP subject extraction
    "dotenv": "^17.2.3",                  // Environment config
    "ffmpeg-static": "^5.3.0",            // FFmpeg binary
    "fluent-ffmpeg": "^2.1.3",            // FFmpeg wrapper
    "openai": "^6.9.1",                   // OpenAI API
    "puppeteer": "^24.32.0",              // Browser automation
    "sharp": "^0.34.5"                    // Image processing
  }
}
```

NOTE: PYTHON folder consists of the same codes in python