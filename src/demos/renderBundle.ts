import { canvasCtx, device, queue } from '../context';
import { GenOptions, Refs } from '../ui';
import { Demo } from './demo';
import vertShaderCode from '../shaders/triangle.vert.wgsl?raw';
import fragShaderCode from '../shaders/triangle.frag.wgsl?raw';

// prettier-ignore
const positions = new Float32Array([
  1.0, -1.0, 0.0, 
  -1.0, -1.0, 0.0, 
  0.0, 1.0, 0.0
]);
// prettier-ignore
const colors = new Float32Array([
  0.0, 0.0, 1.0, // 🔵
  1.0, 0.0, 0.0, // 🔴
  0.0, 1.0, 0.0, // 🟢
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

export class DemoRenderBundle implements Demo {
  name = 'RenderBundle';
  preview = '';
  depthStencilTexture!: GPUTexture;
  depthStencilTextureView!: GPUTextureView;
  bindGroup!: GPUBindGroup;
  buffers!: { positionBuffer: GPUBuffer; indexBuffer: GPUBuffer; colorBuffer: GPUBuffer };
  disposed = false;
  pipeline!: GPURenderPipeline;
  lastSubmitWorkDonePromise?: Promise<undefined>;
  lastRAF!: number;
  colorTexture!: GPUTexture;
  colorTextureView!: GPUTextureView;
  renderBundle!: GPURenderBundle;

  async init(refs: Refs, genOptions: GenOptions): Promise<void> {
    // layout
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: {
            type: 'uniform',
          },
        },
      ],
    });

    const pipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      }),
      vertex: {
        module: device.createShaderModule({ code: vertShaderCode }),
        entryPoint: 'main',
        buffers: [
          {
            arrayStride: 4 * 3,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
            stepMode: 'vertex',
          },
          {
            arrayStride: 4 * 3,
            attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }],
            stepMode: 'vertex',
          },
        ],
      },
      fragment: {
        module: device.createShaderModule({ code: fragShaderCode }),
        entryPoint: 'main',
        targets: [{ format: 'bgra8unorm' }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
        frontFace: 'cw',
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus-stencil8',
      },
      multisample: { count: 4 },
    });

    // 资源
    const positionBuffer = device.createBuffer({
      mappedAtCreation: true,
      size: (positions.byteLength + 3) & ~3,
      usage: GPUBufferUsage.VERTEX,
    });
    new Float32Array(positionBuffer.getMappedRange()).set(positions);
    positionBuffer.unmap();

    const colorBuffer = device.createBuffer({
      mappedAtCreation: true,
      size: (colors.byteLength + 3) & ~3,
      usage: GPUBufferUsage.VERTEX,
    });
    new Float32Array(colorBuffer.getMappedRange()).set(colors);
    colorBuffer.unmap();

    const indexBuffer = device.createBuffer({
      mappedAtCreation: true,
      size: (indices.byteLength + 3) & ~3,
      usage: GPUBufferUsage.INDEX,
    });
    new Uint16Array(indexBuffer.getMappedRange()).set(indices);
    indexBuffer.unmap();

    const uniformBuffer = device.createBuffer({
      mappedAtCreation: true,
      size: (uniformData.byteLength + 3) & ~3,
      usage: GPUBufferUsage.UNIFORM,
    });
    new Float32Array(uniformBuffer.getMappedRange()).set(uniformData);
    uniformBuffer.unmap();

    const bindGourp = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: uniformBuffer },
        },
      ],
    });

    this.bindGroup = bindGourp;
    this.pipeline = pipeline;
    this.buffers = { positionBuffer, indexBuffer, colorBuffer };
    this.disposed = false;

    const canvasConfig: GPUCanvasConfiguration = {
      device,
      format: 'bgra8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      alphaMode: 'opaque',
    };
    canvasCtx.configure(canvasConfig);

    // 初始化renderbundle

    const passEncoder = device.createRenderBundleEncoder({
      colorFormats: ['bgra8unorm'],
      sampleCount: 4,
      depthStencilFormat: 'depth24plus-stencil8',
    });
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.setVertexBuffer(0, this.buffers.positionBuffer);
    passEncoder.setVertexBuffer(1, this.buffers.colorBuffer);
    passEncoder.setIndexBuffer(this.buffers.indexBuffer, 'uint16');
    passEncoder.drawIndexed(3, 1);
    this.renderBundle = passEncoder.finish();
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
      sampleCount: 4,
    });
    // 看着像必占用额外显存了?相比于
    const colorTexture = device.createTexture({
      size: [w, h, 1],
      sampleCount: 4,
      format: 'bgra8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const oldDepthTexture = this.depthStencilTexture;
    const oldColorTexture = this.colorTexture;
    this.depthStencilTexture = depthStencilTexture;
    this.depthStencilTextureView = depthStencilTexture.createView();
    this.colorTexture = colorTexture;
    this.colorTextureView = colorTexture.createView();
    Promise.resolve(this.lastSubmitWorkDonePromise).then(() => {
      oldDepthTexture?.destroy();
      oldColorTexture?.destroy();
    });
  }

  render = () => {
    if (this.disposed) return;

    const commanderEncoder = device.createCommandEncoder();
    const passEncoder = commanderEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.colorTextureView,
          resolveTarget: canvasCtx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
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

    passEncoder.executeBundles([this.renderBundle]);
    passEncoder.end();
    queue.submit([commanderEncoder.finish()]);
    this.lastSubmitWorkDonePromise = queue.onSubmittedWorkDone();
    this.lastRAF = requestAnimationFrame(this.render);
  };

  async dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.lastRAF);
    const buffers = this.buffers;

    await this.lastSubmitWorkDonePromise;
    buffers.colorBuffer.destroy();
    buffers.indexBuffer.destroy();
    buffers.positionBuffer.destroy();
  }
}
