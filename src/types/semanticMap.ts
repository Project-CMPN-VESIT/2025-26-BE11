// src/types/semanticMap.ts

export interface IntentExtraction {
  modality?: string;          // "image" | "video" | "audio"
  domain?: string;
  primary_subject?: string;
  context_scene?: string;
  requested_action?: string;
  style_adjectives?: string[];
}


export interface RealismScoring {
  realism_score?: number;         // 0.0–1.0
  abstractness_score?: number;    // 0.0–1.0
  rationale?: string;
  subject_context_score?: number;
  modifier_abstractness_score?: number;
  domain_feasibility_score?: number;
}

export type FeasibilityLabel = "feasible" | "partially_feasible" | "fantasy";

export interface FeasibilityJudgement {
  feasibility_label?: FeasibilityLabel | string;
  realism_overall_score?: number;
  creative_potential_score?: number;
  summary?: string;
}

export interface CostLatency {
  cost?: string;    // "low" | "medium" | "high"
  latency?: string;
}

export interface CostLatencyEstimate {
  fetch?: CostLatency;
  generate?: CostLatency;
}

export interface DecisionReasoning {
  reasoning_trace?: string;
  cost_latency_estimate?: CostLatencyEstimate;
  final_decision?: string;  // "fetch_from_web" | "generate_with_model" | ...
  confidence?: number;
}

export type MediaType = "image" | "video" | "audio";

// ─── NEW: User Media Input Types ──────────────────────────────────────────────

/**
 * The modality of a file the user has optionally attached to their prompt.
 * Distinct from MediaType which describes pipeline output assets.
 */
export type MediaModality = "image" | "video" | "audio";

/**
 * How the user intends the pipeline to use their uploaded media file.
 *
 * - "transform"   → Apply a change directly ON the provided media
 *                   (e.g. "make this photo look like it's raining")
 * - "reference"   → Find or generate something similar to the media
 *                   (e.g. "give me more audio like this dog bark clip")
 * - "style_guide" → Extract the visual/sonic style and apply it to new content
 *                   (e.g. "generate an image with this colour palette")
 * - "replace"     → Media is background context only; the output replaces it entirely
 *                   (e.g. "here's my old logo, make me a new modern one")
 */
export type UserMediaRole = "transform" | "reference" | "style_guide" | "replace";

/**
 * Rich description of a user-uploaded media file produced by Stage 0
 * (mediaUnderstanding.ts). Populated before Stage 1 runs; forwarded
 * through SemanticMap so Stage 2 and Stage 3b can act on it.
 */
export interface MediaContext {
  /** Absolute local path to the uploaded file */
  filePath: string;

  /** Detected media type */
  modality: MediaModality;

  /**
   * Natural-language description of the file's content produced by
   * OpenAI Vision (images/video) or GPT-4o Audio / Whisper (audio).
   */
  description: string;

  /** Semantic tags extracted from the description (5–8 keywords) */
  tags: string[];

  /** Audio only — Whisper speech transcription when speech is present */
  transcription?: string;

  /** Video / audio only — duration in seconds from FFprobe */
  duration?: number;

  /** Image / video only — pixel dimensions */
  resolution?: {
    w: number;
    h: number;
  };
}

/**
 * Populated on SemanticMap after Stage 1 has interpreted the user prompt
 * together with the MediaContext. Drives the media-aware decision rules
 * in Stage 2 and the img2img / style-transfer branches in Stage 3b.
 */
export interface UserMedia {
  /** Whether the user actually supplied a file this run */
  provided: boolean;

  modality: MediaModality;

  /** Human-readable description carried over from MediaContext */
  description: string;

  /** Semantic tags carried over from MediaContext */
  tags: string[];

  /**
   * How Stage 1 decided the file should be used based on the prompt.
   * This is the primary routing signal for Stage 2's decision logic.
   */
  role: UserMediaRole;

  /**
   * Plain-English description of the change to apply when role === "transform".
   * e.g. "change the weather from sunny to rainy"
   * Undefined for all other roles.
   */
  transformation_intent?: string;

  /** Absolute path forwarded to Stage 3b for img2img conditioning */
  file_path: string;
}

// ─── End: User Media Input Types ──────────────────────────────────────────────


// --- NEW: Technical Metadata Interface ---
export interface AssetTechnicalData {
  width: number;
  height: number;
  orientation: string;
  aspect_ratio: string;
  duration: number;
  fps?: number;
  codec?: string;
  file_size_mb: number;
}

// --- UPDATED: AssetClassification ---
export interface AssetSemanticClassification {
  labels: string[];
  confidence: number;
  human_presence: boolean;
  environment?: string;
}

export interface AssetSemantics {
  // Visual/Image/Video properties
  primary_scene?: string;
  environment?: string;
  time_of_day?: string;
  weather?: string;
  indoor_outdoor?: string;

  shot_type?: string;
  camera_angle?: string;
  composition?: string;
  lighting?: string;

  mood?: string;
  atmosphere?: string;

  human_presence?: boolean;
  people_count_estimate?: number;
  primary_activity?: string;

  dominant_objects?: string[];
  tags?: string[];

  confidence?: number;
  palette?: string[];

  // Audio-specific properties
  audio_type?: string;
  primary_sound?: string;
  intensity_level?: string;
  acoustic_characteristics?: {
    frequency_range?: string;
    clarity?: string;
    background_noise?: string;
  };
  speech_present?: boolean;
  music_present?: boolean;
  sound_effects_present?: boolean;
  emotion?: string;
  use_cases?: string[];
}

export interface AssetClassification {
  technical: {
    type: "image" | "video";
    width: number;
    height: number;
    orientation: string;
    aspect_ratio: string;
    duration: number;
    fps?: number;
    codec?: string;
    file_size_mb: number;
  };

  semantics?: AssetSemantics;

  origin: "generated" | "scraped";
  aspect_ratio: string;
}

export interface FetchedAsset {
  type: MediaType;
  filename: string;
  source?: string;
  model_id?: string;        // Full model identifier e.g. "fal-ai/flux/dev"
  relevance_score?: number; // GPT-4o relevance score from relevanceMatcher (0.0–1.0)
  media_url?: string;
  page_url?: string;
  alt?: string | null;
  query_used?: string | null;
  classification?: AssetClassification;
  width?: number;
  height?: number;
  sha256?: string;
}


// --- NEW: Evaluation Metrics Interfaces ---

export interface Stage1Metrics {
  latency_ms: number;
  completeness_score: number;
  modality_confidence: number;
}

export interface Stage2Metrics {
  latency_ms: number;
  decision_confidence: number;
  cost_efficiency_ratio: number;
}

export interface Stage3Metrics {
  latency_ms: number;
  fetch_yield_rate: number;
  provider_diversity_count: number;
  search_success_rate: number;
}

export interface Stage4Metrics {
  latency_ms: number;
  precision_at_k: number;
  mrr: number;
  visual_diversity_score: number;
  filtering_ratio: number;
  best_match_score: number;
}

export interface EvaluationMetrics {
  stage1?: Stage1Metrics;
  stage2?: Stage2Metrics;
  stage3?: Stage3Metrics;
  stage4?: Stage4Metrics;
  total_latency_ms: number;
  system_health_score: number;
  timestamp: string;
}

export interface SemanticMap {
  user_prompt: string;

  requested_asset_count?: number;
  requested_modality?: MediaType;

  intent_extraction?: IntentExtraction;
  realism_scoring?: RealismScoring;
  feasibility_judgement?: FeasibilityJudgement;
  market_availability_estimate?: number;
  decision_reasoning?: DecisionReasoning;
  fetched_assets?: FetchedAsset[];
  relevant_assets?: FetchedAsset[];
  evaluation_metrics?: EvaluationMetrics;

  /**
   * Populated when the user attaches a media file alongside their prompt.
   * Set by Stage 1 after it has read the MediaContext from Stage 0.
   * Undefined when no file was provided — pipeline behaves as before.
   */
  user_media?: UserMedia;

  [key: string]: any;
}