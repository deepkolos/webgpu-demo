import type { Refs, GenOptions } from '../ui';

export interface Demo {
  name: string;
  preview: string;
  init(refs: Refs, genOptions: GenOptions): Promise<void>;
  resize(): void;
  dispose(): void;
}

export function rangeRandom(min: number, max: number) {
  if (max - min < 0.00001) return min;
  return Math.random() * (max - min) + min;
}
export function hexToRGB(hex: string) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ].map(i => i / 255);
}

export async function loadImageBitmap(src: string): Promise<ImageBitmap> {
  const img = document.createElement('img');
  img.src = src;
  await img.decode();
  return createImageBitmap(img, { imageOrientation: 'flipY' });
}
