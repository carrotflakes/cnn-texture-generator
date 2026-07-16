// Fixed favorites drawer shared by the catalog and editor views.

import { generateTexture, type TextureConfig } from "./types";
import {
  getFavorites,
  getFavoritesError,
  removeFavorite,
  subscribe,
  textureConfigKey,
} from "./favorites";
import { navigate } from "./router";

const PREVIEW_SIZE = 128;
const CATALOG_PER_PAGE = 24;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

export function mountFavoritesDrawer(): () => void {
  const host = document.createElement("aside");
  host.className = "favorites-drawer";
  host.setAttribute("aria-label", "Favorite textures");
  host.innerHTML = `
    <section class="favorites-panel" id="favoritesPanel" aria-hidden="true">
      <header class="favorites-panel-header">
        <div>
          <h2>Favorite textures</h2>
          <p>Saved in this browser</p>
        </div>
        <button class="favorites-close" id="favoritesClose" type="button" aria-label="Close favorites">×</button>
      </header>
      <p class="favorites-error" id="favoritesError" role="status"></p>
      <div class="favorites-list" id="favoritesList" aria-live="polite"></div>
    </section>
    <button
      class="favorites-bar"
      id="favoritesBar"
      type="button"
      aria-expanded="false"
      aria-controls="favoritesPanel"
    >
      <span class="favorites-bar-icon" aria-hidden="true">♥</span>
      <span class="favorites-bar-label">Favorites</span>
      <span class="favorites-count" id="favoritesCount">0</span>
      <span class="favorites-bar-error" id="favoritesBarError" hidden>Storage error</span>
      <span class="favorites-chevron" aria-hidden="true">⌃</span>
    </button>
  `;
  document.body.append(host);

  const panel = host.querySelector<HTMLElement>("#favoritesPanel")!;
  const bar = host.querySelector<HTMLButtonElement>("#favoritesBar")!;
  const closeButton = host.querySelector<HTMLButtonElement>("#favoritesClose")!;
  const count = host.querySelector<HTMLSpanElement>("#favoritesCount")!;
  const error = host.querySelector<HTMLParagraphElement>("#favoritesError")!;
  const barError = host.querySelector<HTMLSpanElement>("#favoritesBarError")!;
  const list = host.querySelector<HTMLDivElement>("#favoritesList")!;

  let alive = true;
  let open = false;
  let renderingPreview = false;
  let observer: IntersectionObserver | null = null;
  const previewCache = new Map<string, ImageData>();
  const pendingPreviews = new Set<string>();
  const previewQueue: Array<{ key: string; config: TextureConfig }> = [];
  let currentCanvases = new Map<string, HTMLCanvasElement>();

  function drawCachedPreview(key: string, canvas: HTMLCanvasElement): boolean {
    const image = previewCache.get(key);
    if (!image) return false;
    canvas.getContext("2d")!.putImageData(image, 0, 0);
    canvas.classList.remove("preview-loading", "preview-error");
    return true;
  }

  async function processPreviewQueue(): Promise<void> {
    if (renderingPreview) return;
    renderingPreview = true;

    while (alive && previewQueue.length > 0) {
      const item = previewQueue.shift()!;
      if (!currentCanvases.has(item.key)) {
        pendingPreviews.delete(item.key);
        continue;
      }

      await nextFrame();
      try {
        const size = item.config.outputSize;
        const pixels = generateTexture(item.config);
        const source = document.createElement("canvas");
        source.width = source.height = size;
        source.getContext("2d")!.putImageData(new ImageData(pixels, size, size), 0, 0);

        const preview = document.createElement("canvas");
        preview.width = preview.height = PREVIEW_SIZE;
        preview.getContext("2d")!.drawImage(source, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
        const image = preview.getContext("2d")!.getImageData(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
        previewCache.set(item.key, image);

        const current = currentCanvases.get(item.key);
        if (current) drawCachedPreview(item.key, current);
      } catch (previewError) {
        console.error(previewError);
        currentCanvases.get(item.key)?.classList.add("preview-error");
      } finally {
        pendingPreviews.delete(item.key);
      }
    }

    renderingPreview = false;
  }

  function queuePreview(key: string, config: TextureConfig): void {
    const canvas = currentCanvases.get(key);
    if (!canvas || drawCachedPreview(key, canvas) || pendingPreviews.has(key)) return;
    pendingPreviews.add(key);
    previewQueue.push({ key, config: { ...config } });
    void processPreviewQueue();
  }

  function observePreviews(): void {
    observer?.disconnect();
    observer = null;
    if (!open) return;

    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const canvas = entry.target as HTMLCanvasElement;
            const key = canvas.dataset.favoriteKey!;
            const favorite = getFavorites().find((item) => textureConfigKey(item.config) === key);
            if (favorite) queuePreview(key, favorite.config);
            observer?.unobserve(canvas);
          }
        },
        { root: list, rootMargin: "80px" },
      );
      currentCanvases.forEach((canvas) => observer!.observe(canvas));
      return;
    }

    getFavorites().forEach((favorite) => queuePreview(textureConfigKey(favorite.config), favorite.config));
  }

  function openFavorite(config: TextureConfig): void {
    const fromPage = Math.max(0, Math.floor(config.networkSeed / CATALOG_PER_PAGE));
    navigate("edit", {
      net: config.networkSeed,
      noise: config.noiseSeed,
      ch: config.channels,
      fn: config.fineness,
      inj: config.inject,
      size: config.outputSize,
      from: fromPage,
    });
  }

  function render(): void {
    const favorites = getFavorites();
    const message = getFavoritesError();
    count.textContent = String(favorites.length);
    error.textContent = message ?? "";
    error.hidden = !message;
    barError.hidden = !message;

    observer?.disconnect();
    currentCanvases = new Map();
    list.replaceChildren();

    if (favorites.length === 0) {
      const empty = document.createElement("p");
      empty.className = "favorites-empty";
      empty.textContent = "Use the heart on a texture to keep it here.";
      list.append(empty);
      return;
    }

    for (const favorite of favorites) {
      const key = textureConfigKey(favorite.config);
      const item = document.createElement("article");
      item.className = "favorite-item";

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "favorite-open";
      openButton.setAttribute(
        "aria-label",
        `Open favorite, network seed ${favorite.config.networkSeed}, noise seed ${favorite.config.noiseSeed}`,
      );

      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = PREVIEW_SIZE;
      canvas.className = "preview-loading";
      canvas.dataset.favoriteKey = key;
      drawCachedPreview(key, canvas);
      currentCanvases.set(key, canvas);

      const caption = document.createElement("span");
      caption.className = "favorite-caption";
      caption.innerHTML = `
        <strong>#${favorite.config.networkSeed}</strong>
        <span>${favorite.config.outputSize}px · noise ${favorite.config.noiseSeed}</span>
      `;
      openButton.append(canvas, caption);
      openButton.addEventListener("click", () => openFavorite(favorite.config));

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "favorite-remove";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `Remove network seed ${favorite.config.networkSeed} from favorites`);
      removeButton.addEventListener("click", () => removeFavorite(favorite.config));

      item.append(openButton, removeButton);
      list.append(item);
    }

    observePreviews();
  }

  function setOpen(next: boolean): void {
    open = next;
    host.classList.toggle("is-open", open);
    document.body.classList.toggle("favorites-open", open);
    bar.setAttribute("aria-expanded", String(open));
    panel.setAttribute("aria-hidden", String(!open));
    panel.inert = !open;
    host.querySelector<HTMLElement>(".favorites-chevron")!.textContent = open ? "⌄" : "⌃";
    if (open) {
      observePreviews();
      closeButton.focus();
    } else {
      observer?.disconnect();
    }
  }

  bar.addEventListener("click", () => setOpen(!open));
  closeButton.addEventListener("click", () => {
    setOpen(false);
    bar.focus();
  });
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !open) return;
    setOpen(false);
    bar.focus();
  };
  document.addEventListener("keydown", handleKeydown);

  const unsubscribe = subscribe(render);
  render();
  setOpen(false);

  return () => {
    alive = false;
    unsubscribe();
    observer?.disconnect();
    document.removeEventListener("keydown", handleKeydown);
    document.body.classList.remove("favorites-open");
    host.remove();
  };
}
