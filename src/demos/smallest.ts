import { canvasCtx, device, queue } from '../context';
import { GenOptions, Refs } from '../ui';
import { Demo } from './demo';
import vertShaderCode from '../shaders/triangle.vert.wgsl?raw';
import fragShaderCode from '../shaders/triangle.frag.wgsl?raw';
import preview from '../assets/screenshots/triangle.png';

// prettier-ignore
const positions = new Float32Array([
  1.0, -1.0, 0.0, 
  -1.0, -1.0, 0.0, 
  0.0, 1.0, 0.0
]);
// prettier-ignore
const colors = new Float32Array([
  1.0, 0.0, 0.0, // 🔴
  0.0, 1.0, 0.0, // 🟢
  0.0, 0.0, 1.0, // 🔵
]);
const indices = new Uint16Array([0, 1, 2]);
const uniformData = new Float32Array([
  // ♟️ ModelViewProjection Matrix (Identity)
  1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
  // 🔴 Primary Color
  0.9, 0.1, 0.3, 1.0,
  // 🟣 Accent Color
  0.8, 0.2, 0.8, 1.0,
]);

export class DemoSmallest implements Demo {
  name = 'Smallest';
  preview = preview;
  depthStencilTexture!: GPUTexture;
  depthStencilTextureView!: GPUTextureView;
  disposed = false;
  pipeline!: GPURenderPipeline;
  lastSubmitWorkDonePromise?: Promise<undefined>;
  lastRAF!: number;

  async init(refs: Refs, genOptions: GenOptions): Promise<void> {
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: {
        module: device.createShaderModule({
          code: /* wgsl */ `@vertex
fn main() -> @builtin(position) vec4f { 
  return vec4f(0.0, 0.0, 0.5, 1.0);
}`,
        }),
        entryPoint: 'main',
      },
      fragment: {
        module: device.createShaderModule({
          code: /* wgsl */ `@fragment
fn main() -> @location(0) vec4f {
  return vec4f(1, 0, 0, 1);
}`,
        }),
        entryPoint: 'main',
        targets: [{ format: 'bgra8unorm' }],
      },
      primitive: {
        topology: 'point-list',
        cullMode: 'back',
        frontFace: 'cw',
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus-stencil8',
      },
    });

    this.pipeline = pipeline;
    this.disposed = false;

    const canvasConfig: GPUCanvasConfiguration = {
      device,
      format: 'bgra8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      alphaMode: 'opaque',
    };
    canvasCtx.configure(canvasConfig);
    this.render();
  }

  resize() {
    const w = canvasCtx.canvas.width;
    const h = canvasCtx.canvas.height;
    const depthStencilTexture = device.createTexture({
      size: [w, h, 1],
      dimension: '2d',
      format: 'depth24plus-stencil8',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const oldTexture = this.depthStencilTexture;
    this.depthStencilTexture = depthStencilTexture;
    this.depthStencilTextureView = depthStencilTexture.createView();
    Promise.resolve(this.lastSubmitWorkDonePromise).then(() => oldTexture?.destroy());
  }

  render = () => {
    if (this.disposed) return;
    const colorTexture = canvasCtx.getCurrentTexture();
    const colorView = colorTexture.createView();

    const commanderEncoder = device.createCommandEncoder();
    const passEncoder = commanderEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0, g: 1, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthStencilTextureView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        stencilClearValue: 0,
        stencilLoadOp: 'clear',
        stencilStoreOp: 'store',
      },
    });
    // const w = canvasCtx.canvas.width;
    // const h = canvasCtx.canvas.height;
    passEncoder.setPipeline(this.pipeline);
    // passEncoder.setViewport(0, 0, w, h, 0, 1);
    // passEncoder.setScissorRect(0, 0, w, h);
    passEncoder.draw(1);

    passEncoder.end();
    queue.submit([commanderEncoder.finish()]);
    this.lastSubmitWorkDonePromise = queue.onSubmittedWorkDone();
    this.lastRAF = requestAnimationFrame(this.render);
  };

  async dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.lastRAF);
  }
}
