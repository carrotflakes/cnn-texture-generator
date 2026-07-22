// Core CNN texture generation logic.
// A typed, side-effect-free port of the original cnn-gen.html script.

const SATURATION = 0.25;
const CONTRAST = 1.9;

export interface Rng {
  next(): number;
  gauss(): number;
  int(max: number): number;
}

export interface Layer {
  weights: Float32Array;
  bias: Float32Array;
}

export interface DenseLayer {
  weights: Float32Array;
  bias: Float32Array;
}

export interface Genome {
  channels: number;
  leakyReluSlope: [number, number];
  firstLayer: Layer;
  lastLayer: Layer;
  outputLayer: DenseLayer;
}

export interface RenderParams {
  fineness: number;
  inject: number;
  outputSize: number;
  noiseSeed: number;
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  let spare: number | null = null;

  function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function gauss(): number {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const radius = Math.sqrt(-2 * Math.log(u));
    spare = radius * Math.sin(2 * Math.PI * v);
    return radius * Math.cos(2 * Math.PI * v);
  }

  return { next, gauss, int: (max: number) => Math.floor(next() * max) };
}

function addConv(
  acc: Float32Array,
  src: Float32Array,
  size: number,
  kernel: Float32Array,
  offset: number,
): void {
  for (let y = 0; y < size; y++) {
    const rowUp = ((y - 1 + size) % size) * size;
    const row = y * size;
    const rowDown = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      acc[row + x] +=
        kernel[offset] * src[rowUp + left] +
        kernel[offset + 1] * src[rowUp + x] +
        kernel[offset + 2] * src[rowUp + right] +
        kernel[offset + 3] * src[row + left] +
        kernel[offset + 4] * src[row + x] +
        kernel[offset + 5] * src[row + right] +
        kernel[offset + 6] * src[rowDown + left] +
        kernel[offset + 7] * src[rowDown + x] +
        kernel[offset + 8] * src[rowDown + right];
    }
  }
}

function convApply(
  features: Float32Array[],
  size: number,
  layer: Layer,
  outputChannels: number,
): Float32Array[] {
  const inputChannels = features.length;
  const output: Float32Array[] = [];
  for (let outChannel = 0; outChannel < outputChannels; outChannel++) {
    const acc = new Float32Array(size * size).fill(layer.bias[outChannel]);
    for (let inChannel = 0; inChannel < inputChannels; inChannel++) {
      addConv(acc, features[inChannel], size, layer.weights, (outChannel * inputChannels + inChannel) * 9);
    }
    output.push(acc);
  }
  return output;
}

function upscale2x(src: Float32Array, size: number): Float32Array {
  const outputSize = size * 2;
  const output = new Float32Array(outputSize * outputSize);
  for (let y = 0; y < outputSize; y++) {
    const y0 = y >> 1;
    const y1 = (y0 + 1) % size;
    const ty = (y & 1) * 0.5;
    for (let x = 0; x < outputSize; x++) {
      const x0 = x >> 1;
      const x1 = (x0 + 1) % size;
      const tx = (x & 1) * 0.5;
      output[y * outputSize + x] =
        (1 - ty) * ((1 - tx) * src[y0 * size + x0] + tx * src[y0 * size + x1]) +
        ty * ((1 - tx) * src[y1 * size + x0] + tx * src[y1 * size + x1]);
    }
  }
  return output;
}

function normalizeAndActivate(features: Float32Array[], slope: number): void {
  let sum = 0;
  let count = 0;
  for (const channel of features) {
    for (let i = 0; i < channel.length; i++) {
      channel[i] = channel[i] > 0 ? channel[i] : channel[i] * slope;
      sum += channel[i];
      count++;
    }
  }
  const mean = sum / count;
  let variance = 0;
  for (const channel of features) {
    for (let i = 0; i < channel.length; i++) variance += (channel[i] - mean) ** 2;
  }
  const standardDeviation = Math.sqrt(variance / count) + 1e-8;
  for (const channel of features) {
    for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] - mean) / standardDeviation;
  }
}

function makeLayer(outputChannels: number, inputChannels: number, rng: Rng): Layer {
  const weights = new Float32Array(outputChannels * inputChannels * 9);
  const scale = Math.sqrt(2 / (inputChannels * 9));
  for (let i = 0; i < weights.length; i++) weights[i] = rng.gauss() * scale;
  const bias = new Float32Array(outputChannels);
  for (let i = 0; i < bias.length; i++) bias[i] = rng.gauss() * 0.1;
  return { weights, bias };
}

function makeDenseLayer(outputChannels: number, inputChannels: number, rng: Rng): DenseLayer {
  const weights = new Float32Array(outputChannels * inputChannels);
  const scale = Math.sqrt(2 / inputChannels);
  for (let i = 0; i < weights.length; i++) weights[i] = rng.gauss() * scale;
  const bias = new Float32Array(outputChannels);
  for (let i = 0; i < bias.length; i++) bias[i] = rng.gauss() * 0.1;
  return { weights, bias };
}

function denseApply(
  features: Float32Array[],
  layer: DenseLayer,
  outputChannels: number,
): Float32Array[] {
  const inputChannels = features.length;
  const length = features[0]?.length ?? 0;
  const output: Float32Array[] = [];
  for (let outChannel = 0; outChannel < outputChannels; outChannel++) {
    const values = new Float32Array(length).fill(layer.bias[outChannel]);
    for (let inChannel = 0; inChannel < inputChannels; inChannel++) {
      const weight = layer.weights[outChannel * inputChannels + inChannel];
      const input = features[inChannel];
      for (let i = 0; i < length; i++) values[i] += weight * input[i];
    }
    output.push(values);
  }
  return output;
}

export function makeGenome(channels: number, rng: Rng): Genome {
  return {
    channels: channels,
    leakyReluSlope: [rng.next() ** 2, rng.next() ** 2],
    firstLayer: makeLayer(channels, channels, rng),
    lastLayer: makeLayer(channels, channels, rng),
    outputLayer: makeDenseLayer(3, channels, rng),
  };
}

function interpolateLayers(first: Layer, last: Layer, nSteps: number): Layer[] {
  return Array.from({ length: nSteps }, (_, index): Layer => {
    if (index === 0) return first;
    if (index === nSteps - 1) return last;
    const ratio = index / (nSteps - 1);
    const weights = new Float32Array(first.weights.length);
    const bias = new Float32Array(first.bias.length);
    for (let i = 0; i < weights.length; i++) weights[i] = first.weights[i] * (1 - ratio) + last.weights[i] * ratio;
    for (let i = 0; i < bias.length; i++) bias[i] = first.bias[i] * (1 - ratio) + last.bias[i] * ratio;
    return { weights, bias };
  });
}

function toPixels(rgb: Float32Array[], size: number): Uint8ClampedArray<ArrayBuffer> {
  let min = Infinity;
  let max = -Infinity;
  for (const channel of rgb) {
    for (const value of channel) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  const scale = 1 / (max - min + 1e-8);
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const color = rgb.map((channel) => (channel[i] - min) * scale);
    const luminance = (color[0] + color[1] + color[2]) / 3;
    for (let component = 0; component < 3; component++) {
      const saturated = luminance + SATURATION * (color[component] - luminance);
      pixels[i * 4 + component] = Math.min(1, Math.max(0, (saturated - 0.5) * CONTRAST + 0.5)) * 255;
    }
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

export function render(genome: Genome, params: RenderParams): Uint8ClampedArray<ArrayBuffer> {
  const nSteps = Math.max(1, Math.log2(params.outputSize) - params.fineness);
  const layers = interpolateLayers(genome.firstLayer, genome.lastLayer, nSteps);
  const scale = 2 ** layers.length;
  const startSize = params.outputSize / scale;
  if (!Number.isInteger(startSize)) throw new Error(`Output size must be a multiple of ${scale}`);

  const rng = makeRng(params.noiseSeed);
  let size = startSize;
  let features: Float32Array[] = Array.from({ length: genome.channels }, () => {
    const channel = new Float32Array(size * size);
    for (let i = 0; i < channel.length; i++) channel[i] = rng.gauss();
    return channel;
  });

  for (const layer of layers) {
    features = features.map((channel) => upscale2x(channel, size));
    size *= 2;
    const strength = params.inject * (startSize / size);
    for (const channel of features) {
      for (let i = 0; i < channel.length; i++) channel[i] += strength * rng.gauss();
    }
    features = convApply(features, size, layer, genome.channels);
    const leakySlope = genome.leakyReluSlope[0] + (genome.leakyReluSlope[1] - genome.leakyReluSlope[0]) * (size / params.outputSize);
    normalizeAndActivate(features, leakySlope);
  }

  return toPixels(denseApply(features, genome.outputLayer, 3), size);
}
