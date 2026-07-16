// Persistent favorite texture storage shared by every view.

import type { TextureConfig } from "./types";

const STORAGE_KEY = "cnn-texture-generator:favorites:v1";
const STORAGE_VERSION = 1;
const OUTPUT_SIZES = new Set([64, 128, 256, 512, 1024]);

export interface FavoriteTexture {
  config: TextureConfig;
  createdAt: number;
}

interface StoredFavorites {
  version: 1;
  items: FavoriteTexture[];
}

type Listener = () => void;

const listeners = new Set<Listener>();
let favorites: FavoriteTexture[] = [];
let storageError: string | null = null;

function normalizedConfig(config: TextureConfig): TextureConfig {
  return {
    channels: Math.trunc(config.channels),
    fineness: Math.trunc(config.fineness),
    inject: Math.round(config.inject * 10) / 10,
    networkSeed: Math.trunc(config.networkSeed),
    noiseSeed: Math.trunc(config.noiseSeed),
    outputSize: Math.trunc(config.outputSize),
  };
}

function isValidConfig(value: unknown): value is TextureConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<TextureConfig>;
  return (
    Number.isInteger(config.channels) &&
    config.channels! >= 1 &&
    config.channels! <= 6 &&
    Number.isInteger(config.fineness) &&
    config.fineness! >= 1 &&
    config.fineness! <= 7 &&
    typeof config.inject === "number" &&
    Number.isFinite(config.inject) &&
    config.inject >= 0 &&
    config.inject <= 2 &&
    Number.isInteger(config.networkSeed) &&
    Number.isInteger(config.noiseSeed) &&
    Number.isInteger(config.outputSize) &&
    OUTPUT_SIZES.has(config.outputSize!)
  );
}

function isValidFavorite(value: unknown): value is FavoriteTexture {
  if (!value || typeof value !== "object") return false;
  const favorite = value as Partial<FavoriteTexture>;
  return isValidConfig(favorite.config) && typeof favorite.createdAt === "number" && Number.isFinite(favorite.createdAt);
}

export function textureConfigKey(config: TextureConfig): string {
  const value = normalizedConfig(config);
  return JSON.stringify([
    value.channels,
    value.fineness,
    value.inject,
    value.networkSeed,
    value.noiseSeed,
    value.outputSize,
  ]);
}

function cloneFavorite(favorite: FavoriteTexture): FavoriteTexture {
  return {
    config: { ...favorite.config },
    createdAt: favorite.createdAt,
  };
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function parseStoredFavorites(raw: string | null): { items: FavoriteTexture[]; error: string | null } {
  if (raw === null) return { items: [], error: null };

  try {
    const parsed = JSON.parse(raw) as Partial<StoredFavorites>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.items)) {
      return { items: [], error: "Saved favorites use an unsupported format." };
    }

    const seen = new Set<string>();
    const items: FavoriteTexture[] = [];
    let discarded = false;

    for (const value of parsed.items) {
      if (!isValidFavorite(value)) {
        discarded = true;
        continue;
      }
      const favorite: FavoriteTexture = {
        config: normalizedConfig(value.config),
        createdAt: value.createdAt,
      };
      const key = textureConfigKey(favorite.config);
      if (seen.has(key)) {
        discarded = true;
        continue;
      }
      seen.add(key);
      items.push(favorite);
    }

    return {
      items,
      error: discarded ? "Some invalid saved favorites were ignored." : null,
    };
  } catch {
    return { items: [], error: "Saved favorites could not be read." };
  }
}

function loadFavorites(): void {
  try {
    const result = parseStoredFavorites(localStorage.getItem(STORAGE_KEY));
    favorites = result.items;
    storageError = result.error;
  } catch {
    favorites = [];
    storageError = "Local storage is unavailable. Favorites cannot be saved.";
  }
}

function persist(next: FavoriteTexture[]): boolean {
  const payload: StoredFavorites = {
    version: STORAGE_VERSION,
    items: next,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    favorites = next;
    storageError = null;
    notify();
    return true;
  } catch {
    storageError = "Local storage is unavailable or full. Your change was not saved.";
    notify();
    return false;
  }
}

export function getFavorites(): FavoriteTexture[] {
  return favorites.map(cloneFavorite);
}

export function getFavoritesError(): string | null {
  return storageError;
}

export function isFavorite(config: TextureConfig): boolean {
  const key = textureConfigKey(config);
  return favorites.some((favorite) => textureConfigKey(favorite.config) === key);
}

export function toggleFavorite(config: TextureConfig): boolean {
  const normalized = normalizedConfig(config);
  if (!isValidConfig(normalized)) {
    storageError = "Current texture settings are invalid and cannot be saved.";
    notify();
    return false;
  }
  const key = textureConfigKey(normalized);
  const index = favorites.findIndex((favorite) => textureConfigKey(favorite.config) === key);

  if (index >= 0) {
    const next = favorites.filter((_, favoriteIndex) => favoriteIndex !== index);
    return persist(next) ? false : true;
  }

  const next: FavoriteTexture[] = [
    { config: normalized, createdAt: Date.now() },
    ...favorites,
  ];
  return persist(next);
}

export function removeFavorite(config: TextureConfig): boolean {
  const key = textureConfigKey(config);
  const next = favorites.filter((favorite) => textureConfigKey(favorite.config) !== key);
  if (next.length === favorites.length) return true;
  return persist(next);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  const result = parseStoredFavorites(event.newValue);
  favorites = result.items;
  storageError = result.error;
  notify();
});

loadFavorites();
