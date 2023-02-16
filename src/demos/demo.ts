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
export const rotateAound = (
  out: vec3,
  rotateOrigin: vec3,
  rotatedPoint: vec3,
  rotateDirection: vec3,
  angleRad: number,
): vec3 => {
  // 旋转的方向是不是需要使用四元数来表示, 然后变化的是旋转的角度
  // 四元数是一个旋转轴+旋转角度组成, 旋转轴是, 通过cross可以求出旋转轴,然后组装成四元数
  // 可以简单测试下,确实是之前的想法

  // 坐标系转换, 转到旋转点的坐标系
  const originToPoint = vec3.create();
  const rotateAxis = vec3.create();
  const q = quat.create();
  vec3.subtract(originToPoint, rotatedPoint, rotateOrigin);
  vec3.normalize(originToPoint, originToPoint);
  vec3.cross(rotateAxis, originToPoint, rotateDirection);
  vec3.normalize(rotateAxis, rotateAxis);

  return out;
};

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
