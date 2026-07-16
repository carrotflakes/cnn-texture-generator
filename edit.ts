// Editor mode: single-texture generation UI with all parameters, single/3×3 previews, and PNG export.

import { generateTexture, DEFAULT_CONFIG, type TextureConfig } from "./types";
import { navigate, replace } from "./router";
import { seedField, wireSteppers } from "./stepper";
import { isFavorite, subscribe as subscribeFavorites, toggleFavorite } from "./favorites";
import {
  formatInject,
  injectFromSlider,
  INJECT_SLIDER_MAX,
  INJECT_SLIDER_MIN,
  sliderFromInject,
} from "./inject";

const OUTPUT_SIZES = [64, 128, 256, 512, 1024];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function numParam(params: URLSearchParams, key: string, fallback: number): number {
  const value = Number(params.get(key));
  return Number.isFinite(value) && params.get(key) !== null ? value : fallback;
}

export function mountEdit(root: HTMLElement, params: URLSearchParams): () => void {
  const config: TextureConfig = {
    channels: numParam(params, "ch", DEFAULT_CONFIG.channels),
    fineness: numParam(params, "fn", DEFAULT_CONFIG.fineness),
    inject: numParam(params, "inj", DEFAULT_CONFIG.inject),
    networkSeed: Math.trunc(numParam(params, "net", DEFAULT_CONFIG.networkSeed)),
    noiseSeed: Math.trunc(numParam(params, "noise", DEFAULT_CONFIG.noiseSeed)),
    outputSize: numParam(params, "size", 256),
  };
  const fromPage = Math.max(0, Math.trunc(numParam(params, "from", 0)));

  let alive = true;
  let previewMode: "single" | "tiled" = "single";
  let debounceTimer: number | undefined;

  const sizeOptions = OUTPUT_SIZES.map(
    (size) => `<option value="${size}"${size === config.outputSize ? " selected" : ""}>${size} px</option>`,
  ).join("");

  root.innerHTML = `
    <div class="edit">
      <header class="edit-header">
        <button type="button" id="back" class="back-button">← Back to Catalog</button>
        <h1>CNN Texture Editor</h1>
      </header>

      <form class="controls" id="editControls">
        <label>
          <span class="label-row"><span>channels</span><output id="chVal"></output></span>
          <input id="ch" type="range" min="1" max="6" step="1" value="${config.channels}">
        </label>
        ${seedField("net", "network seed", config.networkSeed)}
        <label>
          <span class="label-row"><span>fineness</span><output id="fnVal"></output></span>
          <input id="fn" type="range" min="1" max="7" step="1" value="${config.fineness}">
        </label>
        <label>
          <span class="label-row"><span>inject</span><output id="injVal"></output></span>
          <input
            id="inj"
            type="range"
            min="${INJECT_SLIDER_MIN}"
            max="${INJECT_SLIDER_MAX}"
            step="1"
            value="${sliderFromInject(config.inject)}"
          >
        </label>
        <label>
          output_size
          <select id="size">${sizeOptions}</select>
        </label>
        ${seedField("noise", "noise seed", config.noiseSeed)}
      </form>

      <p class="status" id="status" aria-live="polite"></p>
      <figure class="result">
        <canvas id="canvas" width="${config.outputSize}" height="${config.outputSize}" aria-label="Generated texture"></canvas>
        <canvas class="hidden" id="tiledCanvas" aria-label="3×3 tiled generated texture"></canvas>
        <figcaption>
          <span id="outputLabel"></span>
          <span class="preview-actions">
            <span class="mode-switch" role="group" aria-label="Preview mode">
              <button class="active" id="singleMode" type="button" aria-pressed="true">Single</button>
              <button id="tiledMode" type="button" aria-pressed="false">3×3</button>
            </span>
            <button id="favorite" type="button" aria-pressed="false">♡ Favorite</button>
            <button id="download" type="button">Save PNG</button>
          </span>
        </figcaption>
      </figure>
    </div>
  `;

  const form = root.querySelector<HTMLFormElement>("#editControls")!;
  const chInput = root.querySelector<HTMLInputElement>("#ch")!;
  const fnInput = root.querySelector<HTMLInputElement>("#fn")!;
  const injInput = root.querySelector<HTMLInputElement>("#inj")!;
  const netInput = root.querySelector<HTMLInputElement>("#net")!;
  const noiseInput = root.querySelector<HTMLInputElement>("#noise")!;
  const sizeInput = root.querySelector<HTMLSelectElement>("#size")!;
  const chVal = root.querySelector<HTMLOutputElement>("#chVal")!;
  const fnVal = root.querySelector<HTMLOutputElement>("#fnVal")!;
  const injVal = root.querySelector<HTMLOutputElement>("#injVal")!;
  const canvas = root.querySelector<HTMLCanvasElement>("#canvas")!;
  const tiledCanvas = root.querySelector<HTMLCanvasElement>("#tiledCanvas")!;
  const status = root.querySelector<HTMLParagraphElement>("#status")!;
  const outputLabel = root.querySelector<HTMLSpanElement>("#outputLabel")!;
  const singleModeButton = root.querySelector<HTMLButtonElement>("#singleMode")!;
  const tiledModeButton = root.querySelector<HTMLButtonElement>("#tiledMode")!;
  const favoriteButton = root.querySelector<HTMLButtonElement>("#favorite")!;
  const downloadButton = root.querySelector<HTMLButtonElement>("#download")!;

  function readForm(): void {
    config.channels = Number(chInput.value);
    config.fineness = Number(fnInput.value);
    config.inject = injectFromSlider(Number(injInput.value));
    config.networkSeed = Math.trunc(Number(netInput.value));
    config.noiseSeed = Math.trunc(Number(noiseInput.value));
    config.outputSize = Number(sizeInput.value);
    chVal.value = String(config.channels);
    fnVal.value = String(config.fineness);
    injVal.value = formatInject(config.inject);
    injInput.setAttribute("aria-valuetext", injVal.value);
  }

  function syncUrl(): void {
    replace("edit", {
      net: config.networkSeed,
      noise: config.noiseSeed,
      ch: config.channels,
      fn: config.fineness,
      inj: config.inject,
      size: config.outputSize,
      from: fromPage,
    });
  }

  function syncFavoriteButton(): void {
    const active = isFavorite(config);
    favoriteButton.classList.toggle("active", active);
    favoriteButton.setAttribute("aria-pressed", String(active));
    favoriteButton.textContent = active ? "♥ Favorited" : "♡ Favorite";
  }

  function updateTiledPreview(size: number): void {
    tiledCanvas.width = tiledCanvas.height = size * 3;
    const context = tiledCanvas.getContext("2d")!;
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) context.drawImage(canvas, x * size, y * size);
    }
  }

  function setPreviewMode(mode: "single" | "tiled"): void {
    previewMode = mode;
    const tiled = mode === "tiled";
    canvas.classList.toggle("hidden", tiled);
    tiledCanvas.classList.toggle("hidden", !tiled);
    singleModeButton.classList.toggle("active", !tiled);
    tiledModeButton.classList.toggle("active", tiled);
    singleModeButton.setAttribute("aria-pressed", String(!tiled));
    tiledModeButton.setAttribute("aria-pressed", String(tiled));
  }

  async function generate(): Promise<void> {
    if (!form.checkValidity()) return;
    status.textContent = "Generating…";
    await nextFrame();
    if (!alive) return;
    try {
      const pixels = generateTexture(config);
      canvas.width = canvas.height = config.outputSize;
      canvas.getContext("2d")!.putImageData(new ImageData(pixels, config.outputSize, config.outputSize), 0, 0);
      updateTiledPreview(config.outputSize);
      outputLabel.textContent = `${config.outputSize} × ${config.outputSize} px`;
      status.textContent = `network seed ${config.networkSeed} / noise seed ${config.noiseSeed}`;
    } catch (error) {
      console.error(error);
      status.textContent = `Generation failed: ${(error as Error).message}`;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    readForm();
    syncUrl();
    void generate();
  });

  form.addEventListener("input", () => {
    readForm();
    syncUrl();
    syncFavoriteButton();
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => void generate(), 180);
  });

  singleModeButton.addEventListener("click", () => setPreviewMode("single"));
  tiledModeButton.addEventListener("click", () => setPreviewMode("tiled"));
  favoriteButton.addEventListener("click", () => toggleFavorite(config));

  downloadButton.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = `cnn-texture_network${config.networkSeed}_noise${config.noiseSeed}_${config.outputSize}px.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  root.querySelector<HTMLButtonElement>("#back")!.addEventListener("click", () => {
    navigate("catalog", {
      page: fromPage,
      ch: config.channels,
      fn: config.fineness,
      inj: config.inject,
      noise: config.noiseSeed,
    });
  });

  wireSteppers(root);
  const unsubscribeFavorites = subscribeFavorites(syncFavoriteButton);
  readForm();
  syncFavoriteButton();
  setPreviewMode(previewMode);
  void generate();

  return () => {
    alive = false;
    window.clearTimeout(debounceTimer);
    unsubscribeFavorites();
  };
}
