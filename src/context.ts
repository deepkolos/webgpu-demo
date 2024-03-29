import type { Refs } from './ui';

export let adapter: GPUAdapter;
export let device: GPUDevice;
export let queue: GPUQueue;
export let canvasCtx: GPUCanvasContext;
export let canvasFormat: GPUTextureFormat;

export async function initContext(refs: Refs) {
  // 🏭 Entry to WebGPU
  const entry: GPU = navigator.gpu;
  if (!entry) return false;

  // 🔌 Physical Device Adapter
  adapter = (await entry.requestAdapter({ forceFallbackAdapter: false }))!;

  adapter.requestAdapterInfo?.().then(console.log);
  // 💻 Logical Device
  device = await adapter.requestDevice();
  queue = device.queue;
  canvasCtx = refs.gfx.getContext('webgpu')!;
  canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  if (!canvasCtx) throw new Error('get webgpu context fail');
}
