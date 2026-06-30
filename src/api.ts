/** Typed wrappers around the Tauri commands. */

import { invoke } from "@tauri-apps/api/core";
import type { DetectionResult, ModelInfo } from "./types";
import type { CapturedFrame } from "./camera";

export function listModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("list_models");
}

export function detect(
  model: string,
  frame: CapturedFrame
): Promise<DetectionResult> {
  // Tauri maps camelCase JS args to snake_case Rust args automatically.
  return invoke<DetectionResult>("detect", {
    model,
    imageBase64: frame.base64,
    width: frame.width,
    height: frame.height,
  });
}
