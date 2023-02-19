import { quat, vec3 } from 'gl-matrix';
import { device } from '../context';
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

export const align = (len: number, alignment: number = 4) => {
  return (len + (alignment - 1)) & ~(alignment - 1);
};

export function createBuffer(
  data: Float32Array | Uint32Array | Uint8Array,
  usage: GPUFlagsConstant,
  mappedAtCreation = false,
  alignment = 16,
) {
  const buffer = device.createBuffer({
    usage,
    size: align(data.byteLength, alignment),
    mappedAtCreation,
  });
  if (mappedAtCreation) {
    // @ts-ignore
    new data.constructor(buffer.getMappedRange()).set(data);
    buffer.unmap();
  }
  return buffer;
}

export const degToRad = (deg: number) => (Math.PI * deg) / 180;
export const radToDeg = (rad: number) => (rad * 180) / Math.PI;
export const randomBetween = (min: number, max: number) => Math.random() * (max - min) + min;
export const sleep = (t: number) => new Promise(resolve => setTimeout(resolve, t));

export const getRotateAxis = (
  out: vec3,
  rotateOrigin: vec3,
  rotatedPoint: vec3,
  rotateDirection: vec3,
) => {
  const originToPoint = vec3.create();
  vec3.subtract(originToPoint, rotatedPoint, rotateOrigin);
  vec3.normalize(originToPoint, originToPoint);
  vec3.cross(out, originToPoint, rotateDirection);
  vec3.normalize(out, out);

  return out;
};
