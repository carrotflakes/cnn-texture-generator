// Catalog mode: browse pages of thumbnails generated with different network seeds.

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

const PER_PAGE = 24; // 6 columns × 4 rows
const THUMB_SIZE = 128;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function intParam(params: URLSearchParams, key: string, fallback: number): number {
  const value = Number(params.get(key));
  return Number.isFinite(value) && params.get(key) !== null ? value : fallback;
}

interface CatalogState {
  page: number;
  channels: number;
  fineness: number;
  inject: number;
  noiseSeed: number;
}

// Mounts the catalog and returns a disposer that stops generation when leaving the view.
export function mountCatalog(root: HTMLElement, params: URLSearchParams): () => void {
  const state: CatalogState = {
    page: Math.max(0, Math.trunc(intParam(params, "page", 0))),
    channels: intParam(params, "ch", DEFAULT_CONFIG.channels),
    fineness: intParam(params, "fn", 2),
    inject: injectFromSlider(sliderFromInject(intParam(params, "inj", 1.0))),
    noiseSeed: Math.trunc(intParam(params, "noise", 1234)),
  };

  let alive = true;
  let token = 0;

  root.innerHTML = `
    <div class="catalog">
      <header class="catalog-header">
        <div>
          <h1>CNN Texture Catalog</h1>
          <p class="description">Browse textures with different network seeds, then select one to edit.</p>
        </div>
      </header>

      <form class="controls catalog-controls" id="catalogControls">
        <label>
          <span class="label-row"><span>channels</span><output id="chVal"></output></span>
          <input id="ch" type="range" min="1" max="6" step="1">
        </label>
        <label>
          <span class="label-row"><span>fineness</span><output id="fnVal"></output></span>
          <input id="fn" type="range" min="1" max="7" step="1">
        </label>
        <label>
          <span class="label-row"><span>inject</span><output id="injVal"></output></span>
          <input id="inj" type="range" min="${INJECT_SLIDER_MIN}" max="${INJECT_SLIDER_MAX}" step="1">
        </label>
        ${seedField("noise", "noise seed", state.noiseSeed)}
      </form>

      <nav class="pager">
        <button type="button" id="prev">◀ Previous</button>
        <span class="pager-info">
          Page <input id="pageInput" type="number" min="1" step="1" class="page-input">
        </span>
        <button type="button" id="next">Next ▶</button>
        <span class="pager-range" id="pagerRange"></span>
      </nav>

      <div class="grid" id="grid"></div>
    </div>
  `;

  const chInput = root.querySelector<HTMLInputElement>("#ch")!;
  const fnInput = root.querySelector<HTMLInputElement>("#fn")!;
  const injInput = root.querySelector<HTMLInputElement>("#inj")!;
  const noiseInput = root.querySelector<HTMLInputElement>("#noise")!;
  const chVal = root.querySelector<HTMLOutputElement>("#chVal")!;
  const fnVal = root.querySelector<HTMLOutputElement>("#fnVal")!;
  const injVal = root.querySelector<HTMLOutputElement>("#injVal")!;
  const pageInput = root.querySelector<HTMLInputElement>("#pageInput")!;
  const pagerRange = root.querySelector<HTMLSpanElement>("#pagerRange")!;
  const grid = root.querySelector<HTMLDivElement>("#grid")!;
  const prevButton = root.querySelector<HTMLButtonElement>("#prev")!;
  const nextButton = root.querySelector<HTMLButtonElement>("#next")!;

  const canvases: HTMLCanvasElement[] = [];
  const favoriteButtons: HTMLButtonElement[] = [];
  for (let i = 0; i < PER_PAGE; i++) {
    const cell = document.createElement("article");
    cell.className = "cell";
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "cell-open";
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = THUMB_SIZE;
    const caption = document.createElement("span");
    caption.className = "cell-caption";
    openButton.append(canvas, caption);
    openButton.addEventListener("click", () => openInEditor(state.page * PER_PAGE + i));

    const favoriteButton = document.createElement("button");
    favoriteButton.type = "button";
    favoriteButton.className = "cell-favorite";
    favoriteButton.addEventListener("click", () => toggleFavorite(configForIndex(i)));

    cell.append(openButton, favoriteButton);
    grid.append(cell);
    canvases.push(canvas);
    favoriteButtons.push(favoriteButton);
  }

  function configForIndex(index: number): TextureConfig {
    return {
      channels: state.channels,
      fineness: state.fineness,
      inject: state.inject,
      networkSeed: state.page * PER_PAGE + index,
      noiseSeed: state.noiseSeed,
      outputSize: THUMB_SIZE,
    };
  }

  function openInEditor(seed: number): void {
    navigate("edit", {
      net: seed,
      noise: state.noiseSeed,
      ch: state.channels,
      fn: state.fineness,
      inj: state.inject,
      size: 256,
      from: state.page,
    });
  }

  function syncControls(): void {
    chInput.value = String(state.channels);
    fnInput.value = String(state.fineness);
    injInput.value = String(sliderFromInject(state.inject));
    noiseInput.value = String(state.noiseSeed);
    chVal.value = String(state.channels);
    fnVal.value = String(state.fineness);
    injVal.value = formatInject(state.inject);
    injInput.setAttribute("aria-valuetext", injVal.value);
    pageInput.value = String(state.page + 1);
    const first = state.page * PER_PAGE;
    pagerRange.textContent = `seed ${first} – ${first + PER_PAGE - 1}`;
    prevButton.disabled = state.page === 0;
  }

  function syncUrl(): void {
    replace("catalog", {
      page: state.page,
      ch: state.channels,
      fn: state.fineness,
      inj: state.inject,
      noise: state.noiseSeed,
    });
  }

  function syncFavoriteButtons(): void {
    favoriteButtons.forEach((button, index) => {
      const config = configForIndex(index);
      const active = isFavorite(config);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute(
        "aria-label",
        `${active ? "Remove" : "Add"} network seed ${config.networkSeed} ${active ? "from" : "to"} favorites`,
      );
      button.textContent = "♥";
    });
  }

  async function renderGrid(): Promise<void> {
    const gen = ++token;
    for (let i = 0; i < PER_PAGE; i++) {
      if (!alive || gen !== token) return;
      const seed = state.page * PER_PAGE + i;
      const config = configForIndex(i);
      const cell = canvases[i].closest<HTMLElement>(".cell")!;
      const caption = cell.querySelector<HTMLElement>(".cell-caption")!;
      const openButton = cell.querySelector<HTMLButtonElement>(".cell-open")!;
      try {
        const pixels = generateTexture(config);
        canvases[i].getContext("2d")!.putImageData(new ImageData(pixels, THUMB_SIZE, THUMB_SIZE), 0, 0);
        caption.textContent = `#${seed}`;
        openButton.setAttribute("aria-label", `Open texture with network seed ${seed}`);
        cell.classList.remove("cell-error");
      } catch (error) {
        caption.textContent = "×";
        cell.classList.add("cell-error");
        console.error(error);
      }
      await nextFrame();
    }
  }

  function refresh(): void {
    syncControls();
    syncUrl();
    syncFavoriteButtons();
    void renderGrid();
  }

  function goToPage(page: number): void {
    state.page = Math.max(0, Math.trunc(page));
    refresh();
    grid.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  root.querySelector<HTMLFormElement>("#catalogControls")!.addEventListener("input", () => {
    state.channels = Number(chInput.value);
    state.fineness = Number(fnInput.value);
    state.inject = injectFromSlider(Number(injInput.value));
    const noise = Math.trunc(Number(noiseInput.value));
    if (Number.isFinite(noise)) state.noiseSeed = noise;
    refresh();
  });

  prevButton.addEventListener("click", () => goToPage(state.page - 1));
  nextButton.addEventListener("click", () => goToPage(state.page + 1));
  pageInput.addEventListener("change", () => {
    const page = Number(pageInput.value) - 1;
    if (Number.isFinite(page)) goToPage(page);
  });

  wireSteppers(root);
  const unsubscribeFavorites = subscribeFavorites(syncFavoriteButtons);
  refresh();

  return () => {
    alive = false;
    unsubscribeFavorites();
  };
}
