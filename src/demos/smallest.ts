import { canvasCtx, device, queue } from '../context';
import { GenOptions, Refs } from '../ui';
import { Demo } from './demo';

export class DemoSmallest implements Demo {
  name = 'Smallest';
  preview = '';
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
    });

    passEncoder.setPipeline(this.pipeline);
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
