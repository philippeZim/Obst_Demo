/** Camera capture: live preview + per-frame square snapshots for inference. */

export interface CapturedFrame {
  /** base64-encoded JPEG, without the `data:` URL prefix. */
  base64: string;
  width: number;
  height: number;
}

export class Camera {
  private stream: MediaStream | null = null;
  private readonly canvas = document.createElement("canvas");

  /**
   * @param video   the <video> element used for the live preview
   * @param target  edge length the captured square frame is downscaled to
   *                (Fruit-360 images are 100x100)
   */
  constructor(
    private readonly video: HTMLVideoElement,
    private readonly target = 100
  ) {}

  /** Request the rear camera and start the preview. Throws if denied. */
  async start(): Promise<void> {
    // getUserMedia only exists in a secure context (https / localhost / the
    // Tauri webview). Over plain LAN http it is undefined.
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Camera API unavailable — open the app via the Tauri webview or a secure (https/localhost) context."
      );
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /**
   * Grab the current frame, centre-cropped to a square and downscaled.
   * Returns null until the video has dimensions.
   */
  capture(): CapturedFrame | null {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return null;

    const size = this.target;
    this.canvas.width = size;
    this.canvas.height = size;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return null;

    // Centre-crop the largest square from the source frame.
    const side = Math.min(vw, vh);
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;
    ctx.drawImage(this.video, sx, sy, side, side, 0, 0, size, size);

    const dataUrl = this.canvas.toDataURL("image/jpeg", 0.7);
    return { base64: dataUrl.split(",")[1] ?? "", width: size, height: size };
  }
}
