// Texture generation configuration and the high-level function that produces pixel data.

import { makeRng, makeGenome, render } from "./engine";

export interface TextureConfig {
  channels: number;
  fineness: number;
  inject: number;
  networkSeed: number;
  noiseSeed: number;
  outputSize: number;
}

export const DEFAULT_CONFIG: TextureConfig = {
  channels: 2,
  fineness: 2,
  inject: 1.0,
  networkSeed: 0,
  noiseSeed: 0,
  outputSize: 128,
};

// Generates an RGBA pixel array from a configuration. Callers handle any errors.
export function generateTexture(config: TextureConfig): Uint8ClampedArray<ArrayBuffer> {
  const networkRng = makeRng(config.networkSeed);
  const genome = makeGenome(config.channels, networkRng);
  return render(genome, {
    outputSize: config.outputSize,
    fineness: config.fineness,
    inject: config.inject,
    noiseSeed: config.noiseSeed,
  });
}
