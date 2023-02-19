import { canvasCtx, device, queue } from '../context';
import { GenOptions, Refs } from '../ui';
import { Demo, hexToRGB, loadImageBitmap, rangeRandom } from './demo';
import vertShaderCode from '../shaders/meshline.vert.wgsl?raw';
import fragShaderCode from '../shaders/meshline.frag.wgsl?raw';
import cfg from '../assets/meshline-bench';
import { makePerspectiveHFov } from '../objects/camera';
import { vFov2hFov } from '../objects/math-utils';
import { mat4 } from '../objects/matrix4';
// import { tail1Img } from '../assets/tail-img';
import tail1Img from '../assets/tail.png';
import preview from '../assets/screenshots/meshline.png';

const lineLength = cfg.frameCount + cfg.fadeFrameCount;
const lineNumber = cfg.count;

export class DemoMeshline implements Demo {
  name = 'Meshline';
  preview = preview;
  depthStencilTexture!: GPUTexture;
  depthStencilTextureView!: GPUTextureView;
  bindGroup!: GPUBindGroup;
  disposed = false;
  pipeline!: GPURenderPipeline;
  lastSubmitWorkDonePromise?: Promise<undefined>;
  lastRAF!: number;
  renderBundle!: GPURenderBundle;
  uniformPerInstance!: Float32Array;
  uniformPerFrame!: Float32Array;
  uniformPerInstanceView!: {
    width: number;
    friction: number;
    gravity: number;
    indexSeed: number;
    weights: Float32Array;
    colors: [Float32Array, Float32Array, Float32Array, Float32Array];
  };
  uniformPerFrameBuffer!: GPUBuffer;
  uniformPerInstanceBuffer!: GPUBuffer;
  attributeFrameIndex!: Float32Array;
  attributeFrameIndexBuffer!: GPUBuffer;
  attributeInstanced!: Float32Array;
  attributeInstancedBuffer!: GPUBuffer;
  indicesBuffer!: GPUBuffer;
  uniformPerFrameView!: {
    opacity: number;
    drawRange: Float32Array;
    projectionMatrix: Float32Array;
    modelViewMatrix: Float32Array;
  };
  start = 0;
  end = 0;
  currentFrame = 0;
  indicesLen!: number;

  async init(refs: Refs, genOptions: GenOptions): Promise<void> {
    // layout
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });

    const pipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: device.createShaderModule({ code: vertShaderCode }),
        entryPoint: 'main',
        buffers: [
          {
            arrayStride: 4,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32' }],
            stepMode: 'vertex',
          },
          {
            arrayStride: 4 * 3,
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32' },
              { shaderLocation: 2, offset: 4, format: 'float32' },
              { shaderLocation: 3, offset: 4 * 2, format: 'float32' },
            ],
            stepMode: 'instance',
          },
        ],
      },
      fragment: {
        module: device.createShaderModule({ code: fragShaderCode }),
        entryPoint: 'main',
        targets: [
          {
            format: 'bgra8unorm',
            blend: {
              color: {
                operation: 'add',
                srcFactor: 'src-alpha',
                // dstFactor: 'dst-alpha',
                dstFactor: 'one',
              },
              alpha: {},
            },
            writeMask: GPUColorWrite.ALL,
          },
        ], // shader相关?
      },
      primitive: {
        topology: 'triangle-list',
        // topology: 'point-list',
        // topology: 'line-list',
        // topology: 'line-strip',
        cullMode: 'back',
        frontFace: 'ccw',
      },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: 'always',
        format: 'depth16unorm',
      },
    });

    // uniform
    this.uniformPerInstance = new Float32Array(4 * 6);
    this.uniformPerFrame = new Float32Array(4 + 16 * 2);
    const { uniformPerInstance, uniformPerFrame } = this;
    // prettier-ignore
    this.uniformPerInstanceView = {
      // TODO 改装饰器
      get width() { return uniformPerInstance[0]; },
      set width(v: number) { uniformPerInstance[0] = v; },
      get friction() { return uniformPerInstance[1]; },
      set friction(v: number) { uniformPerInstance[1] = v; },
      get gravity() { return uniformPerInstance[2]; },
      set gravity(v: number) { uniformPerInstance[2] = v; },
      get indexSeed() { return uniformPerInstance[3]; },
      set indexSeed(v: number) { uniformPerInstance[3] = v; },
      weights: new Float32Array(uniformPerInstance.buffer, 4 * 4, 3),
      colors: [
        new Float32Array(uniformPerInstance.buffer, 4 * 2 * 4, 3 ),
        new Float32Array(uniformPerInstance.buffer, 4 * 3 * 4, 3),
        new Float32Array(uniformPerInstance.buffer, 4 * 4 * 4, 3),
        new Float32Array(
          uniformPerInstance.buffer,
          4 * 5 * 4,
          3,
        ),
      ],
    };
    // prettier-ignore
    this.uniformPerFrameView = {
      get opacity() { return uniformPerFrame[0]; },
      set opacity(v: number) { uniformPerFrame[0] = v; },
      drawRange: new Float32Array(uniformPerFrame.buffer, 2 * 4, 2),
      projectionMatrix: new Float32Array(uniformPerFrame.buffer, 4 * 4, 16),
      modelViewMatrix: new Float32Array(uniformPerFrame.buffer, 4 * 4 + 16 * 4, 16),
    };
    this.uniformPerFrameBuffer = device.createBuffer({
      size: (this.uniformPerFrame.byteLength + 15) & ~15,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    this.uniformPerInstanceBuffer = device.createBuffer({
      size: (this.uniformPerInstance.byteLength + 15) & ~15,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    this.uniformPerFrameView.opacity = 1;
    this.uniformPerFrameView.drawRange[0] = 0;
    this.uniformPerFrameView.drawRange[1] = lineLength;
    const w = canvasCtx.canvas.width;
    const h = canvasCtx.canvas.height;
    makePerspectiveHFov(
      this.uniformPerFrameView.projectionMatrix,
      vFov2hFov(45, 757 / 1467),
      w / h,
      0.1,
      10000,
    );
    const modelWorldMatrix = mat4.identity();
    const cameraWorldMatrix = mat4.translate(0, 0, 400);
    const cameraWorldInvertMatrix = mat4.invTo(cameraWorldMatrix);
    mat4.mul(cameraWorldInvertMatrix, modelWorldMatrix, this.uniformPerFrameView.modelViewMatrix);

    // console.log(this.uniformPerFrameView.modelViewMatrix);
    // console.log(this.uniformPerFrameView.projectionMatrix);

    this.uniformPerInstanceView.friction = cfg.friction;
    this.uniformPerInstanceView.gravity = cfg.gravity;
    this.uniformPerInstanceView.indexSeed = Math.random();
    this.uniformPerInstanceView.width = cfg.width;
    const weightSum = cfg.color.weight1 + cfg.color.weight2 + cfg.color.weight3;
    this.uniformPerInstanceView.weights.set([
      cfg.color.weight1 / weightSum,
      cfg.color.weight2 / weightSum,
      cfg.color.weight3 / weightSum,
    ]);
    this.uniformPerInstanceView.colors[0].set(hexToRGB(cfg.color.color1));
    this.uniformPerInstanceView.colors[1].set(hexToRGB(cfg.color.color2));
    this.uniformPerInstanceView.colors[2].set(hexToRGB(cfg.color.color3));
    this.uniformPerInstanceView.colors[3].set(hexToRGB(cfg.color.color4));

    new Float32Array(this.uniformPerFrameBuffer.getMappedRange()).set(this.uniformPerFrame);
    this.uniformPerFrameBuffer.unmap();
    new Float32Array(this.uniformPerInstanceBuffer.getMappedRange()).set(this.uniformPerInstance);
    this.uniformPerInstanceBuffer.unmap();

    const colorImageBitmap = await loadImageBitmap(tail1Img);
    const colorTexture = device.createTexture({
      size: [colorImageBitmap.width, colorImageBitmap.height, 1],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.TEXTURE_BINDING,
    });
    const colorTextureView = colorTexture.createView();
    const colorTextureSampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });

    // 这个是同步还是异步方法?
    queue.copyExternalImageToTexture({ source: colorImageBitmap }, { texture: colorTexture }, [
      colorImageBitmap.width,
      colorImageBitmap.height,
    ]);
    // 如果是异步,此时close bitmap来回收内存, 应该会有报错, 或者纹理不生效
    // colorImageBitmap.close();

    const bindGourp = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformPerInstanceBuffer } },
        { binding: 1, resource: { buffer: this.uniformPerFrameBuffer } },
        { binding: 2, resource: colorTextureSampler },
        { binding: 3, resource: colorTextureView },
      ],
    });

    // attribute
    this.attributeFrameIndex = new Float32Array(lineLength * 2);
    for (let i = 0, il = this.attributeFrameIndex.length; i < il; i++) {
      this.attributeFrameIndex[i] = i;
    }
    this.attributeFrameIndexBuffer = device.createBuffer({
      size: (this.attributeFrameIndex.byteLength + 3) & ~3,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.attributeFrameIndexBuffer.getMappedRange()).set(this.attributeFrameIndex);
    this.attributeFrameIndexBuffer.unmap();

    this.attributeInstanced = new Float32Array(lineNumber * 3);
    const angleCell = (cfg.angleRange[1] - cfg.angleRange[0]) / lineNumber;
    const angleCellRandomness = angleCell * 0.5;

    for (let i = 0; i < lineNumber; i++) {
      const baseAngleCell = i * angleCell;
      this.attributeInstanced[i * 3] = i;
      this.attributeInstanced[i * 3 + 1] = rangeRandom(cfg.vRange[0], cfg.vRange[1]);
      this.attributeInstanced[i * 3 + 2] =
        (rangeRandom(baseAngleCell - angleCellRandomness, baseAngleCell + angleCellRandomness) *
          Math.PI) /
        180;
    }
    this.attributeInstancedBuffer = device.createBuffer({
      size: (this.attributeInstanced.byteLength + 3) & ~3,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.attributeInstancedBuffer.getMappedRange()).set(this.attributeInstanced);
    this.attributeInstancedBuffer.unmap();

    const indices = new Uint16Array(lineLength * 6);
    this.indicesLen = indices.length;
    let offset = 0;
    for (let i = 0; i < lineLength - 1; i++) {
      const n = i * 2;
      indices[offset++] = n;
      indices[offset++] = n + 1;
      indices[offset++] = n + 2;
      indices[offset++] = n + 2;
      indices[offset++] = n + 1;
      indices[offset++] = n + 3;
    }
    this.indicesBuffer = device.createBuffer({
      size: (indices.byteLength + 3) & ~3,
      usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true,
    });
    new Uint16Array(this.indicesBuffer.getMappedRange()).set(indices);
    this.indicesBuffer.unmap();

    this.bindGroup = bindGourp;
    this.pipeline = pipeline;
    this.disposed = false;

    const canvasConfig: GPUCanvasConfiguration = {
      device,
      format: 'bgra8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      alphaMode: 'opaque',
    };
    canvasCtx.configure(canvasConfig);

    // 初始化renderbundle, 需要动态修改drawIndexed的参数就使用不了renderBundle了...
    // const passEncoder = device.createRenderBundleEncoder({
    //   colorFormats: ['bgra8unorm'],
    //   depthStencilFormat: 'depth16unorm',
    //   stencilReadOnly: true,
    // });
    // passEncoder.setPipeline(this.pipeline);
    // passEncoder.setBindGroup(0, this.bindGroup);
    // passEncoder.setVertexBuffer(0, this.attributeFrameIndexBuffer);
    // passEncoder.setVertexBuffer(1, this.attributeInstancedBuffer);
    // passEncoder.setIndexBuffer(this.indicesBuffer, 'uint16');
    // passEncoder.drawIndexed((this.end - this.start) * 6, lineNumber, this.start * 6);
    // this.renderBundle = passEncoder.finish();
    //
    this.render();
  }

  resize() {
    const w = canvasCtx.canvas.width;
    const h = canvasCtx.canvas.height;
    const depthStencilTexture = device.createTexture({
      size: [w, h, 1],
      dimension: '2d',
      format: 'depth16unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    if (this.uniformPerFrameView) {
      makePerspectiveHFov(
        this.uniformPerFrameView.projectionMatrix,
        vFov2hFov(45, 757 / 1467),
        w / h,
        0.1,
        10000,
      );
    }

    const oldDepthTexture = this.depthStencilTexture;
    this.depthStencilTexture = depthStencilTexture;
    this.depthStencilTextureView = depthStencilTexture.createView();
    Promise.resolve(this.lastSubmitWorkDonePromise).then(() => {
      oldDepthTexture?.destroy();
    });
  }

  remainFrame = 0;
  remainTime = 0;
  lastT = 0;
  render = () => {
    if (this.disposed) return;

    const now = performance.now();
    const delta = now - this.lastT;
    this.lastT = now;

    const deltaTime = Math.min(delta + this.remainTime, 0.2); // max 200ms
    const frame = deltaTime * 30 + this.remainFrame;
    if (frame < 1) {
      this.remainTime = deltaTime;
      this.lastRAF = requestAnimationFrame(this.render);
      return;
    }
    this.remainFrame = frame % 1;
    this.remainTime = 0;

    // update start end

    this.start = Math.floor((this.start / cfg.fadeFrameCount) * cfg.fadeFrameCount);
    this.end++;
    if (this.end > lineLength) {
      this.end = 0;
      this.start = 0;
    }

    let alpha = 1.0 - Math.max(this.currentFrame - cfg.frameCount, 0) / cfg.fadeFrameCount;
    this.start = Math.max(this.start, 0);
    this.end = Math.min(this.end, lineLength);
    this.uniformPerFrameView.drawRange[0] = this.start;
    this.uniformPerFrameView.drawRange[1] = this.end;
    this.uniformPerFrameView.opacity = alpha;

    queue.writeBuffer(
      this.uniformPerFrameBuffer,
      0,
      this.uniformPerFrame.buffer,
      this.uniformPerFrame.byteOffset,
      this.uniformPerFrame.byteLength,
    );

    const commanderEncoder = device.createCommandEncoder();
    const passEncoder = commanderEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: canvasCtx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthStencilTextureView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        stencilReadOnly: true,
      },
    });

    // passEncoder.executeBundles([this.renderBundle]);
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.setVertexBuffer(0, this.attributeFrameIndexBuffer);
    passEncoder.setVertexBuffer(1, this.attributeInstancedBuffer);
    passEncoder.setIndexBuffer(this.indicesBuffer, 'uint16');
    passEncoder.drawIndexed((this.end - this.start) * 6, lineNumber, this.start * 6);
    passEncoder.end();
    queue.submit([commanderEncoder.finish()]);
    this.lastSubmitWorkDonePromise = queue.onSubmittedWorkDone();
    this.lastRAF = requestAnimationFrame(this.render);
    // this.lastRAF = setTimeout(this.render, 64);
  };

  async dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.lastRAF);
    const {
      indicesBuffer,
      uniformPerFrameBuffer,
      uniformPerInstanceBuffer,
      attributeInstancedBuffer,
      attributeFrameIndexBuffer,
    } = this;

    await this.lastSubmitWorkDonePromise;
    indicesBuffer.destroy();
    uniformPerFrameBuffer.destroy();
    uniformPerInstanceBuffer.destroy();
    attributeInstancedBuffer.destroy();
    attributeFrameIndexBuffer.destroy();
  }
}
