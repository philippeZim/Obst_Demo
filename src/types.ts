/** Shared types mirroring the Rust backend (`src-tauri/src/detector.rs`). */

export interface ModelInfo {
  id: string;
  label: string;
  description: string;
}

export interface Prediction {
  class: string;
  /** Confidence in [0, 1]. */
  confidence: number;
}

export interface DetectionResult {
  model: string;
  /** Sorted by descending confidence. */
  predictions: Prediction[];
  /** Human-readable error message (shown in the UI). */
  error?: string | null;
  /** Raw model response for debugging. */
  raw?: string | null;
}
