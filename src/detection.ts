/** Drives the live recognition loop: capture frame -> detect -> emit result. */

import { detect } from "./api";
import type { Camera } from "./camera";
import type { DetectionResult } from "./types";

export interface DetectionHandlers {
  onResult: (result: DetectionResult) => void;
  onError?: (error: unknown) => void;
  /** Fired when a capture starts / finishes so the UI can show a spinner. */
  onLoading?: (loading: boolean) => void;
}

export class DetectionLoop {
  private timer: number | null = null;
  private inFlight = false;

  /**
   * @param intervalMs how often to sample a frame and run recognition
   * @param manual when true, no interval is started; call capture() to trigger manually
   */
  constructor(
    private readonly camera: Camera,
    private readonly modelId: string,
    private readonly handlers: DetectionHandlers,
    private readonly intervalMs = 600,
    private readonly manual = false
  ) {}

  start(): void {
    if (this.timer !== null) return;
    if (this.manual) return;
    this.timer = window.setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  capture(): void {
    void this.tick();
  }

  private async tick(): Promise<void> {
    // Skip if the previous inference hasn't returned yet.
    if (this.inFlight) return;
    const frame = this.camera.capture();
    if (!frame) return;

    this.inFlight = true;
    this.handlers.onLoading?.(true);
    try {
      const result = await detect(this.modelId, frame);
      this.handlers.onResult(result);
    } catch (error) {
      this.handlers.onError?.(error);
    } finally {
      this.inFlight = false;
      this.handlers.onLoading?.(false);
    }
  }
}
