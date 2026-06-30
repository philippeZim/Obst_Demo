/** Drives the live recognition loop: capture frame -> detect -> emit result. */

import { detect } from "./api";
import type { Camera } from "./camera";
import type { DetectionResult } from "./types";

export interface DetectionHandlers {
  onResult: (result: DetectionResult) => void;
  onError?: (error: unknown) => void;
}

export class DetectionLoop {
  private timer: number | null = null;
  private inFlight = false;

  /**
   * @param intervalMs how often to sample a frame and run recognition
   */
  constructor(
    private readonly camera: Camera,
    private readonly modelId: string,
    private readonly handlers: DetectionHandlers,
    private readonly intervalMs = 600
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    // Skip if the previous inference hasn't returned yet.
    if (this.inFlight) return;
    const frame = this.camera.capture();
    if (!frame) return;

    this.inFlight = true;
    try {
      const result = await detect(this.modelId, frame);
      this.handlers.onResult(result);
    } catch (error) {
      this.handlers.onError?.(error);
    } finally {
      this.inFlight = false;
    }
  }
}
