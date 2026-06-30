import { listModels } from "./api";
import { Camera } from "./camera";
import { DetectionLoop } from "./detection";
import type { DetectionResult, ModelInfo } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;

/** Active detection session, so we can tear it down on navigation. */
interface Session {
  camera: Camera;
  loop: DetectionLoop;
}
let session: Session | null = null;

function stopSession(): void {
  session?.loop.stop();
  session?.camera.stop();
  session = null;
}

/** Show a loading spinner in the ranking area. */
function setRankingLoading(el: HTMLElement, loading: boolean): void {
  if (loading) {
    el.innerHTML = `<li class="ranking-empty ranking-loading">
      <span class="spinner"></span>
      Analyzing with VLM…
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

  const isVlm = model.id === "vlm";
  const badgeClass = isVlm ? "badge badge-manual" : "badge badge-live";
  const badgeText = isVlm ? "Manual" : "Live";
  const captureButton = isVlm
    ? `<button class="button button-capture" id="capture">
        <span class="button-spinner"></span>
        <span class="button-label">Capture & Detect</span>
      </button>`
    : "";

  app.innerHTML = `
    <div class="screen detection">
      <header class="detection-bar">
        <button class="button button-ghost button-icon" id="back" aria-label="Back">‹</button>
        <div class="bar-title">
          <span class="bar-label">${escapeHtml(model.label)}</span>
          <span class="${badgeClass}">${badgeText}</span>
        </div>
        <span class="bar-spacer"></span>
      </header>

      <div class="card camera-card">
        <video id="preview" class="camera-video" playsinline muted autoplay></video>
        <div class="camera-status" id="status">Requesting camera…</div>
      </div>

      ${captureButton}

      <div class="card ranking-card">
        <div class="card-header">
          <h2 class="card-title">Detected fruit</h2>
          <p class="card-desc">Ranked by confidence</p>
        </div>
        <ul class="ranking-list" id="ranking">
          <li class="ranking-empty">Waiting for first prediction…</li>
        </ul>
      </div>
    </div>
  `;

  app.querySelector("#back")!.addEventListener("click", () => void showSelection());

  const video = app.querySelector<HTMLVideoElement>("#preview")!;
  const statusEl = app.querySelector<HTMLDivElement>("#status")!;
  const rankingEl = app.querySelector<HTMLUListElement>("#ranking")!;

  const camera = new Camera(video);
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

  const captureEl = isVlm
    ? app.querySelector<HTMLButtonElement>("#capture")!
    : null;

  const loop = new DetectionLoop(camera, model.id, {
    onResult: (result) => renderRanking(rankingEl, result),
    onError: (error) => {
      console.error("detection failed:", error);
      renderRanking(rankingEl, {
        model: model.id,
        predictions: [],
        error: String(error),
      });
    },
    onLoading: (loading) => {
      setRankingLoading(rankingEl, loading);
      if (captureEl) {
        captureEl.disabled = loading;
        captureEl.classList.toggle("button-loading", loading);
      }
    },
  }, 600, isVlm);

  if (isVlm && captureEl) {
    captureEl.addEventListener("click", () => {
      setRankingLoading(rankingEl, true);
      captureEl.disabled = true;
      captureEl.classList.add("button-loading");
      loop.capture();
    });
  } else {
    loop.start();
  }

  session = { camera, loop };
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
