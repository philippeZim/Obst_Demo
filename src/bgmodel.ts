/**
 * Background removal with the RMBG-1.4 model (BRIA, ISNet-based) running fully
 * in the webview via transformers.js + onnxruntime-web.
 *
 * The model is downloaded once from the HuggingFace hub (~44 MB) and cached by
 * the browser. WebGPU is used when the webview supports it (much faster, full
 * 1024px quality); otherwise it falls back to WASM at a smaller size so it stays
 * usable on a phone.
 *
 * All inference is serialized through a single lock because the onnxruntime
 * session must not be entered concurrently (the live preview and the detection
 * loop both call in).
 */

import {
  AutoModel,
  AutoProcessor,
  RawImage,
  env,
  type PreTrainedModel,
  type Processor,
} from "@huggingface/transformers";

// We always fetch from the hub, never look for local model files on disk.
env.allowLocalModels = false;

export type LoadProgress = (pct: number) => void;

const MODEL_ID = "briaai/RMBG-1.4";
const HAS_WEBGPU =
  typeof navigator !== "undefined" && "gpu" in navigator && !!navigator.gpu;

let model: PreTrainedModel | null = null;
let processor: Processor | null = null;
let loadPromise: Promise<void> | null = null;
let runLock: Promise<unknown> = Promise.resolve();
const progressCbs = new Set<LoadProgress>();

function buildProcessor(size: number): Promise<Processor> {
  // RMBG-1.4 ships no standard preprocessor_config, so specify it explicitly.
  return AutoProcessor.from_pretrained(MODEL_ID, {
    config: {
      do_normalize: true,
      do_pad: false,
      do_rescale: true,
      do_resize: true,
      image_mean: [0.5, 0.5, 0.5],
      image_std: [1, 1, 1],
      resample: 2,
      size: { width: size, height: size },
    },
  } as never);
}

async function init(): Promise<void> {
  const report = (p: { status?: string; progress?: number }) => {
    if (p.status === "progress" && typeof p.progress === "number") {
      const pct = Math.round(p.progress);
      progressCbs.forEach((cb) => cb(pct));
    }
  };

  // Prefer WebGPU at full quality; fall back to WASM at a phone-friendly size.
  if (HAS_WEBGPU) {
    try {
      model = await AutoModel.from_pretrained(MODEL_ID, {
        device: "webgpu",
        dtype: "fp32",
        progress_callback: report,
      } as never);
      processor = await buildProcessor(1024);
      return;
    } catch (e) {
      console.warn("[bgmodel] WebGPU init failed, falling back to WASM:", e);
      model = null;
    }
  }

  model = await AutoModel.from_pretrained(MODEL_ID, {
    device: "wasm",
    dtype: "fp32",
    progress_callback: report,
  } as never);
  processor = await buildProcessor(512);
}

/** Kick off (or join) the one-time model download + initialisation. */
export function loadModel(onProgress?: LoadProgress): Promise<void> {
  if (onProgress) progressCbs.add(onProgress);
  if (!loadPromise) {
    loadPromise = init().finally(() => {
      progressCbs.forEach((cb) => cb(100));
    });
  }
  return loadPromise;
}

export function isModelReady(): boolean {
  return model !== null && processor !== null;
}

/**
 * Run RMBG on one frame and return a `width*height` foreground alpha mask
 * (0 = background, 255 = object), matching the previous segmenter's contract.
 */
export async function removeBackgroundMask(
  image: ImageData
): Promise<Uint8Array> {
  await loadModel();
  const m = model;
  const p = processor;
  if (!m || !p) throw new Error("background model not initialised");

  // Serialize: the onnx session is not safe to enter concurrently.
  const task = runLock.then(async () => {
    const input = new RawImage(image.data, image.width, image.height, 4);
    const processed = (await p(input)) as { pixel_values: unknown };
    const out = (await m({ input: processed.pixel_values })) as Record<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >;
    const tensor = out.output ?? Object.values(out)[0];
    // tensor: [1, 1, S, S] in [0,1] -> single-channel uint8 image at model size
    const small = RawImage.fromTensor(tensor[0].mul(255).to("uint8"));
    const resized = await small.resize(image.width, image.height);
    return Uint8Array.from(resized.data); // single-channel mask, length w*h
  });

  runLock = task.catch(() => {});
  return task;
}
