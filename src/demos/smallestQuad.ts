import { canvasCtx, device, queue } from '../context';
import { GenOptions, Refs } from '../ui';
import { Demo } from './demo';

export class DemoSmallestQuad implements Demo {
  name = 'SmallestQuad';
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
          code: /* wgsl */ `
var<private> quadPosition = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0),
  vec2<f32>(-1.0, 1.0),
  vec2<f32>(1.0, 1.0),
  vec2<f32>(-1.0, -1.0),
  vec2<f32>(1.0, 1.0),
  vec2<f32>(1.0, -1.0),
);
@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f { 
  return vec4f(quadPosition[vertexIndex], 0.5, 1.0);
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
        topology: 'triangle-list',
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

  resize() {}

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
    passEncoder.draw(6);

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
