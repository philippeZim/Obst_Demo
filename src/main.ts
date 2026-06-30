import { detect, listModels } from "./api";
import { loadModel } from "./bgmodel";
import { Camera } from "./camera";
import { captureAndMask } from "./segment";
import type { DetectionResult, ModelInfo } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;

/** Active detection session, so we can tear it down on navigation. */
interface Session {
  camera: Camera;
}
let session: Session | null = null;

function stopSession(): void {
  session?.camera.stop();
  session = null;
}

/** Show a loading spinner in the ranking area. */
function setRankingLoading(el: HTMLElement, loading: boolean): void {
  if (loading) {
    el.innerHTML = `<li class="ranking-empty ranking-loading">
      <span class="spinner"></span>
      Analyzing…
    </li>`;
  }
}

// --- Screens ---------------------------------------------------------------

async function showSelection(): Promise<void> {
  stopSession();

  let models: ModelInfo[] = [];
  try {
    models = await listModels();
  } catch (error) {
    app.innerHTML = errorView(
      "Could not load recognition models.",
      String(error)
    );
    return;
  }

  app.innerHTML = `
    <div class="screen start">
      <header class="app-header">
        <div class="app-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z" />
            <path d="M10 2c1 .5 2 2 2 5" />
          </svg>
        </div>
        <h1 class="app-title">Fruit Recognition</h1>
      </header>
      <div class="model-grid">
        ${models.map(modelCard).join("")}
      </div>
    </div>
  `;

  app.querySelectorAll<HTMLElement>("[data-model]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.model!;
      const model = models.find((m) => m.id === id)!;
      void showDetection(model);
    });
  });
}

async function showDetection(model: ModelInfo): Promise<void> {
  stopSession();

  app.innerHTML = `
    <div class="screen detection">
      <header class="detection-bar">
        <button class="button button-ghost button-icon" id="back" aria-label="Back">‹</button>
        <div class="bar-title">
          <span class="bar-label">${escapeHtml(model.label)}</span>
          <span class="badge badge-manual">Manual</span>
        </div>
        <span class="bar-spacer"></span>
      </header>

      <div class="card camera-card">
        <video id="preview" class="camera-video" playsinline muted autoplay></video>
        <canvas id="result" class="camera-result hidden"></canvas>
        <button class="result-close hidden" id="result-close" aria-label="New capture">✕</button>
        <div class="camera-status" id="status">Requesting camera…</div>
      </div>

      <button class="button button-capture" id="capture" disabled>
        <span class="button-spinner"></span>
        <span class="button-label">Capture &amp; Detect</span>
      </button>

      <div class="card ranking-card">
        <div class="card-header">
          <h2 class="card-title">Detected fruit</h2>
          <p class="card-desc">Ranked by confidence</p>
        </div>
        <ul class="ranking-list" id="ranking">
          <li class="ranking-empty">Press “Capture &amp; Detect” to analyze a frame.</li>
        </ul>
      </div>
    </div>
  `;

  app.querySelector("#back")!.addEventListener("click", () => void showSelection());

  const video = app.querySelector<HTMLVideoElement>("#preview")!;
  const statusEl = app.querySelector<HTMLDivElement>("#status")!;
  const rankingEl = app.querySelector<HTMLUListElement>("#ranking")!;
  const captureEl = app.querySelector<HTMLButtonElement>("#capture")!;
  const resultEl = app.querySelector<HTMLCanvasElement>("#result")!;
  const closeEl = app.querySelector<HTMLButtonElement>("#result-close")!;
  const labelEl = captureEl.querySelector<HTMLSpanElement>(".button-label")!;

  const camera = new Camera(video);
  session = { camera };
  try {
    await camera.start();
    statusEl.classList.add("hidden");
  } catch (error) {
    statusEl.textContent =
      "Camera unavailable. Grant camera permission and reload. " +
      `(${String(error)})`;
    statusEl.classList.add("camera-status-error");
    return;
  }

  // Manual-only: segmentation/detection runs solely on a button press, so the
  // live camera view is never slowed down by background processing.
  let busy = false;
  let modelReady = false;
  let showingResult = false;

  const syncButton = () => {
    captureEl.disabled = busy || !modelReady;
    captureEl.classList.toggle("button-loading", busy);
    captureEl.classList.toggle("hidden", showingResult);
    labelEl.textContent = busy ? "Analyzing…" : "Capture & Detect";
  };

  // Download / initialise the RMBG model up front; enable capture once settled
  // (even on failure — capture then runs unmasked rather than being stuck).
  loadModel((pct) => {
    if (!modelReady && pct < 100) labelEl.textContent = `Loading model… ${pct}%`;
  })
    .catch((err) => console.error("background model failed to load:", err))
    .finally(() => {
      modelReady = true;
      syncButton();
    });

  // Return to the live camera view, ready for the next capture.
  const reset = () => {
    showingResult = false;
    resultEl.classList.add("hidden");
    closeEl.classList.add("hidden");
    rankingEl.innerHTML =
      '<li class="ranking-empty">Press “Capture &amp; Detect” to analyze a frame.</li>';
    syncButton();
  };
  closeEl.addEventListener("click", reset);

  captureEl.addEventListener("click", () => {
    if (busy || !modelReady || showingResult) return;
    busy = true;
    syncButton();
    setRankingLoading(rankingEl, true);
    void (async () => {
      try {
        const cap = await captureAndMask(camera);
        if (!cap) {
          renderRanking(rankingEl, {
            model: model.id,
            predictions: [],
            error: "Could not grab a camera frame.",
          });
          return;
        }
        // Replace the live view with the white-background cut-out.
        drawImageData(resultEl, cap.masked);
        showingResult = true;
        resultEl.classList.remove("hidden");
        closeEl.classList.remove("hidden");

        const result = await detect(model.id, cap.frame);
        renderRanking(rankingEl, result);
      } catch (error) {
        console.error("detection failed:", error);
        renderRanking(rankingEl, {
          model: model.id,
          predictions: [],
          error: String(error),
        });
      } finally {
        busy = false;
        syncButton();
      }
    })();
  });
}

/** Paint an `ImageData` onto a canvas at native resolution (CSS scales it). */
function drawImageData(canvas: HTMLCanvasElement, image: ImageData): void {
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(image, 0, 0);
}

// --- Rendering helpers -----------------------------------------------------

function modelCard(model: ModelInfo): string {
  return `
    <button class="card model-card" data-model="${escapeHtml(model.id)}">
      <span class="model-text">
        <span class="model-name">${escapeHtml(model.label)}</span>
        <span class="model-desc">${escapeHtml(model.description)}</span>
      </span>
      <span class="model-arrow" aria-hidden="true">→</span>
    </button>
  `;
}

function renderRanking(el: HTMLElement, result: DetectionResult): void {
  if (result.error) {
    el.innerHTML = `
      <li class="ranking-empty ranking-error">${escapeHtml(result.error)}</li>
      ${result.raw ? `
        <li class="ranking-raw">
          <details>
            <summary>Raw model response</summary>
            <pre>${escapeHtml(result.raw)}</pre>
          </details>
        </li>` : ""
      }`;
    return;
  }

  if (result.predictions.length === 0) {
    el.innerHTML = `<li class="ranking-empty">No detections.</li>`;
    return;
  }

  el.innerHTML = result.predictions
    .map((p, i) => {
      const pct = Math.round(p.confidence * 100);
      return `
        <li class="ranking-row">
          <span class="rank-index">${i + 1}</span>
          <div class="rank-main">
            <div class="rank-top">
              <span class="rank-class">${escapeHtml(p.class)}</span>
              <span class="rank-pct">${pct}%</span>
            </div>
            <div class="rank-bar">
              <div class="rank-bar-fill" style="width:${pct}%"></div>
            </div>
          </div>
        </li>
      `;
    })
    .join("") +
    (result.raw
      ? `
        <li class="ranking-raw">
          <details>
            <summary>Raw model response</summary>
            <pre>${escapeHtml(result.raw)}</pre>
          </details>
        </li>`
      : "");
}

function errorView(title: string, detail: string): string {
  return `
    <div class="screen">
      <div class="card error-card">
        <h2 class="card-title">${escapeHtml(title)}</h2>
        <p class="card-desc">${escapeHtml(detail)}</p>
      </div>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- Boot ------------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => void showSelection());
