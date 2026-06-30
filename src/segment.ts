/**
 * Background removal: runs the RMBG-1.4 model (see `bgmodel.ts`) on a captured
 * frame to get a foreground alpha mask and composites the frame over white,
 * matching the Fruit-360 look.
 *
 * Segmentation only runs on an explicit capture (never live), so the camera
 * preview stays smooth.
 */

import { removeBackgroundMask } from "./bgmodel";
import type { Camera, CapturedFrame } from "./camera";

/** Resolution captured frames are masked at (higher = finer cut-out). */
const CAPTURE_SIZE = 320;

/** Run the segmentation model on one frame, returning a `w*h` alpha mask. */
export function requestMask(image: ImageData): Promise<Uint8Array> {
  return removeBackgroundMask(image);
}

/** Composite `image` over white using `mask` (alpha), mutating it in place. */
export function compositeWhite(image: ImageData, mask: Uint8Array): void {
  const d = image.data;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const a = mask[i];
    if (a === 255) {
      d[p + 3] = 255;
      continue;
    }
    if (a === 0) {
      d[p] = 255;
      d[p + 1] = 255;
      d[p + 2] = 255;
      d[p + 3] = 255;
      continue;
    }
    const inv = 255 - a;
    d[p] = (d[p] * a + 255 * inv) / 255;
    d[p + 1] = (d[p + 1] * a + 255 * inv) / 255;
    d[p + 2] = (d[p + 2] * a + 255 * inv) / 255;
    d[p + 3] = 255;
  }
}

// --- JPEG encoding (shared offscreen canvas) --------------------------------

const encCanvas = document.createElement("canvas");

/** Encode an `ImageData` to a JPEG `CapturedFrame` (no data-URL prefix). */
export function encodeJpeg(image: ImageData, quality = 0.7): CapturedFrame {
  encCanvas.width = image.width;
  encCanvas.height = image.height;
  const ctx = encCanvas.getContext("2d")!;
  ctx.putImageData(image, 0, 0);
  const url = encCanvas.toDataURL("image/jpeg", quality);
  return {
    base64: url.split(",")[1] ?? "",
    width: image.width,
    height: image.height,
  };
}

/** One capture: the original frame, the white-background cut-out, and the JPEG
 *  (of the cut-out) handed to the detector. */
export interface MaskedCapture {
  original: ImageData;
  masked: ImageData;
  frame: CapturedFrame;
}

/**
 * Grab one frame, remove its background, and return the original, the
 * white-background version (for the user to see), and a JPEG of it for
 * detection. If segmentation fails, the masked image falls back to the original
 * so detection still runs.
 */
export async function captureAndMask(
  camera: Camera
): Promise<MaskedCapture | null> {
  const original = camera.grab(CAPTURE_SIZE);
  if (!original) return null;

  const masked = new ImageData(
    new Uint8ClampedArray(original.data),
    original.width,
    original.height
  );
  try {
    const mask = await requestMask(original);
    compositeWhite(masked, mask);
  } catch (error) {
    console.warn("segmentation failed, using unmasked frame:", error);
  }
  return { original, masked, frame: encodeJpeg(masked) };
}
