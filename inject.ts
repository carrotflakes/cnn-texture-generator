// Logarithmic inject slider mapping from 0.1 through 20.

export const INJECT_SLIDER_MIN = 0;
export const INJECT_SLIDER_MAX = 300;

const MIN_INJECT = 0.1;
const MAX_INJECT = 20;
const INJECT_RATIO = MAX_INJECT / MIN_INJECT;

export function injectFromSlider(position: number): number {
  const step = Math.max(INJECT_SLIDER_MIN, Math.min(INJECT_SLIDER_MAX, Math.round(position)));
  const progress = step / INJECT_SLIDER_MAX;
  return Number((MIN_INJECT * INJECT_RATIO ** progress).toPrecision(6));
}

export function sliderFromInject(inject: number): number {
  if (!Number.isFinite(inject)) return INJECT_SLIDER_MIN;
  const clamped = Math.max(MIN_INJECT, Math.min(MAX_INJECT, inject));
  const progress = Math.log(clamped / MIN_INJECT) / Math.log(INJECT_RATIO);
  return Math.round(progress * INJECT_SLIDER_MAX);
}

export function formatInject(inject: number): string {
  return String(Number(inject.toPrecision(3)));
}
