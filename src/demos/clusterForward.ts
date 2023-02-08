import { canvasCtx, canvasFormat, device, queue } from '../context';
import { GenOptions, Refs } from '../ui';
import { createBuffer, degToRad, Demo } from './demo';
import FrustumVertCode from '../shaders/frustum.vert.wgsl?raw';
import FrustumFragCode from '../shaders/frustum.frag.wgsl?raw';
import { mat4, vec4 } from 'gl-matrix';
import { cubePrimitives } from '../assets/boxPrimitivs';

const vfov = degToRad(45);
const DEPTH_FORMAT = 'depth24plus';
const DepthSplitMethod: { [k: string]: number } = {
  'ndc-even': 0, // screen space uneven
  'view-space-even': 1, // screen space uneven
  'DOOM-2016-Siggraph': 2, // screen space even
};

type Params = {
  output: { value: string; options: string[]; onChange: (v: string) => void };
  clusterSize: { value: Vec3; range: Vec2; onChange: (v: Vec3) => void };
  lightNum: { value: number; range: Vec2; onChange: (v: number) => void };
  zRange: { value: Vec2; range: Vec2; onChange: (v: Vec2) => void };
  animateCamera: { value: boolean; onChange: (v: boolean) => void };
  aerialView: { value: boolean; onChange: (v: boolean) => void };
  frustumDepth: { value: string; options: string[]; onChange: (v: string) => void };
};

export class DemoClusterForward implements Demo {
  name = 'ClusterForward';
  preview = '';

  renderFrustum = true;
  renderFinal = false;
  disposed = false;

  params!: Params;
  frustumHelper!: FrustumHelper;
  viewportSpliter = new ViewportSpliter();
  depthTexture!: GPUTexture;
  depthTextureView!: GPUTextureView;

  async init(refs: Refs, genOptions: GenOptions): Promise<void> {
    this.disposed = false;
    this.initUI(refs, genOptions);

    this.frustumHelper =
      this.frustumHelper ||
      new FrustumHelper(
        { colorFormats: [canvasFormat], depthStencilFormat: DEPTH_FORMAT },
        this.params,
      );

    canvasCtx.configure({
      device,
      format: canvasFormat,
      alphaMode: 'opaque',
    });

    requestAnimationFrame(this.render);
  }

  initUI(refs: Refs, genOptions: GenOptions) {
    this.params = {
      output: {
        value: 'cluster-grid',
        options: ['cluster-grid', 'cluster-depth', 'cluster-light', 'final'],
        onChange: (v: string) => {},
      },
      clusterSize: {
        value: [1, 1, 20],
        range: [1, 32],
        onChange: (v: [number, number, number]) => {
          this.frustumHelper.setClusterSize(v);
        },
      },
      lightNum: {
        value: 1,
        range: [1, 1000],
        onChange: (v: number) => {},
      },
      zRange: {
        value: [1, 10],
        range: [0.01, 10000],
        onChange: (v: Vec2) => {},
      },
      frustumDepth: {
        value: 'DOOM-2016-Siggraph',
        options: ['ndc-even', 'view-space-even', 'DOOM-2016-Siggraph'],
        onChange: (v: string) => {},
      },
      animateCamera: {
        value: false,
        onChange: (v: boolean) => {},
      },
      aerialView: {
        value: false,
        onChange: (v: boolean) => {},
      },
    };
    genOptions(this.params);
  }

  allocateViewports() {
    this.viewportSpliter.reset(Number(this.renderFinal) + Number(this.renderFrustum));

    if (this.renderFinal) {
      this.viewportSpliter.getViewport();
    }

    if (this.renderFrustum) {
      this.frustumHelper.setViewport(this.viewportSpliter.getViewport());
    }
  }

  render = () => {
    if (this.disposed) return;

    const commanderEncoder = device.createCommandEncoder();
    const passEncoder = commanderEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: canvasCtx.getCurrentTexture().createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthTextureView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });

    if (this.renderFinal) {
      // passEncoder.setViewport(...this.frustumHelper.viewport, 0, 1);
      // passEncoder.setScissorRect(...this.frustumHelper.viewport);
    }
    if (this.renderFrustum) {
      passEncoder.setViewport(...this.frustumHelper.viewport, 0, 1);
      passEncoder.setScissorRect(...this.frustumHelper.viewport);
      this.frustumHelper.draw(passEncoder);
    }

    passEncoder.end();
    queue.submit([commanderEncoder.finish()]);

    requestAnimationFrame(this.render);
  };

  resize(): void {
    this.allocateViewports();
    const w = canvasCtx.canvas.width;
    const h = canvasCtx.canvas.height;
    this.depthTexture = device.createTexture({
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      format: DEPTH_FORMAT,
      size: [w, h, 1],
      dimension: '2d',
    });
    this.depthTextureView = this.depthTexture.createView();
  }

  dispose(): void {
    this.disposed = true;
  }
}

class FrustumHelper {
  viewport: Vec4 = [0, 0, 1, 1];
  cameraPosition: Vec3 = [0, 0, 4];
  cameraXYPlaneDeg = 0;
  cameraXYPlaneRadius = 1;

  pipeline!: GPURenderPipeline;
  bindGroupLayout!: GPUBindGroupLayout;
  viewUniforms!: Float32Array;
  viewUniformsBuffer!: GPUBuffer;
  frustumUniforms!: Float32Array;
  frustumUniformsBuffer!: GPUBuffer;
  bindGroup!: GPUBindGroup;
  renderBundle!: GPURenderBundle;
  view!: { matrix: Float32Array; projection: Float32Array; zRange: Float32Array };
  frustum!: {
    projection: Float32Array;
    mapping: Float32Array;
    clusterSize: Uint32Array;
    depthSplitMethod: Uint32Array;
  };
  vertexBuffer!: GPUBuffer;
  indexBuffer!: GPUBuffer;

  constructor(
    public renderBundleDescriptor: GPURenderBundleEncoderDescriptor,
    public params: Params,
  ) {
    this.initLayout();
    this.initResource();
    this.initRenderBundle();
  }

  initLayout() {
    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.VERTEX },
        { binding: 1, buffer: { type: 'uniform' }, visibility: GPUShaderStage.VERTEX },
      ],
    });
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: {
        entryPoint: 'main',
        module: device.createShaderModule({ code: FrustumVertCode }),
        buffers: [
          {
            arrayStride: 4 * 3,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
            ],
          },
        ],
      },
      fragment: {
        entryPoint: 'main',
        module: device.createShaderModule({ code: FrustumFragCode }),
        targets: [
          {
            format: canvasFormat,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one' },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
        frontFace: 'cw',
      },
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
  }

  initResource() {
    // uniforms
    this.viewUniforms = new Float32Array(16 + 16 + 2);
    this.view = {
      matrix: new Float32Array(this.viewUniforms.buffer, 0, 16), // camera's world matrix invert
      projection: new Float32Array(this.viewUniforms.buffer, 16 * 4, 16),
      zRange: new Float32Array(this.viewUniforms.buffer, 16 * 2 * 4, 2),
    };
    mat4.identity(this.view.matrix);
    mat4.identity(this.view.projection);
    this.view.zRange[0] = 0.1;
    this.view.zRange[1] = 1;
    this.viewUniformsBuffer = createBuffer(
      this.viewUniforms,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      true,
    );

    this.frustumUniforms = new Float32Array(16 + 16 + 4);
    this.frustum = {
      mapping: new Float32Array(this.frustumUniforms.buffer, 0, 16),
      projection: new Float32Array(this.frustumUniforms.buffer, 16 * 4, 16),
      clusterSize: new Uint32Array(this.frustumUniforms.buffer, 16 * 4 * 2, 3),
      depthSplitMethod: new Uint32Array(this.frustumUniforms.buffer, 16 * 4 * 2 + 3 * 4, 1),
    };
    this.frustum.clusterSize.set(this.params.clusterSize.value);
    this.frustumUniformsBuffer = createBuffer(
      this.frustumUniforms,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      true,
    );

    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.viewUniformsBuffer } },
        { binding: 1, resource: { buffer: this.frustumUniformsBuffer } },
      ],
    });

    // attributes
    // prettier-ignore
    this.vertexBuffer = createBuffer(new Float32Array(cubePrimitives.position), GPUBufferUsage.VERTEX, true);
    this.indexBuffer = createBuffer(
      new Uint32Array(cubePrimitives.indices),
      GPUBufferUsage.INDEX,
      true,
    );
  }

  initRenderBundle() {
    const { clusterSize } = this.frustum;
    const instanceCount = clusterSize[0] * clusterSize[1] * clusterSize[2];
    const encoder = device.createRenderBundleEncoder(this.renderBundleDescriptor);
    encoder.setPipeline(this.pipeline);
    encoder.setBindGroup(0, this.bindGroup);
    encoder.setVertexBuffer(0, this.vertexBuffer);
    encoder.setIndexBuffer(this.indexBuffer, 'uint32');
    encoder.drawIndexed(36, instanceCount);
    this.renderBundle = encoder.finish({ label: 'FrustumBundle' });
  }

  setClusterSize(size: Vec3) {
    if (this.frustum.clusterSize.some((v, k) => v !== size[k])) {
      this.frustum.clusterSize.set(size);
      this.initRenderBundle();
    }
  }

  updateCamera() {
    const [, , w, h] = this.viewport;
    const { zRange } = this.params;
    const [near, far] = zRange.value;
    mat4.perspectiveZO(this.view.projection, vfov, w / h, 1, 1000);

    mat4.perspectiveZO(this.frustum.projection, vfov, w / h, near, far);
    mat4.invert(this.frustum.mapping, this.frustum.projection);

    mat4.targetTo(this.view.matrix, this.cameraPosition, [0, 0, -near], [0, 1, 0]);
    mat4.invert(this.view.matrix, this.view.matrix);

    this.view.zRange.set(zRange.value);
  }

  setViewport(size: Vec4) {
    this.viewport = size;
    this.updateCamera();
  }

  draw(passEncoder: GPURenderPassEncoder) {
    // move camera round
    this.cameraXYPlaneDeg = (this.cameraXYPlaneDeg + 1) % 360;
    if (this.params.animateCamera.value) {
      this.cameraPosition[0] = Math.cos(degToRad(this.cameraXYPlaneDeg)) * this.cameraXYPlaneRadius;
      this.cameraPosition[1] = Math.sin(degToRad(this.cameraXYPlaneDeg)) * this.cameraXYPlaneRadius;
    } else {
      this.cameraPosition[0] = 0;
      this.cameraPosition[1] = 0;
    }
    if (this.params.aerialView.value) {
      this.cameraPosition[0] = 0;
      this.cameraPosition[1] = 28;
    }
    this.updateCamera();
    this.frustum.depthSplitMethod[0] = DepthSplitMethod[this.params.frustumDepth.value] || 0;

    // update buffers TODO update ondemand
    queue.writeBuffer(this.frustumUniformsBuffer, 0, this.frustumUniforms);
    queue.writeBuffer(this.viewUniformsBuffer, 0, this.viewUniforms);

    // draw
    passEncoder.executeBundles([this.renderBundle]);
  }
}

class ViewportSpliter {
  itemId = 0;
  splitLen = 1;
  splitDir: 'x' | 'y' = 'y';

  reset(splitLen: number) {
    this.itemId = 0;
    this.splitLen = splitLen;
  }

  getViewport(): Vec4 {
    let { width, height } = canvasCtx.canvas;
    if (this.itemId >= this.splitLen) {
      console.error('itemId exceed splitLen');
      return [0, 0, width, height];
    }
    const id = this.itemId;
    this.itemId++;

    if (this.splitDir === 'x') {
      width /= this.splitLen;
      return [width * id, 0, width, height];
    } else {
      height /= this.splitLen;
      return [0, height * (this.splitLen - 1 - id), width, height];
    }
  }
}

function idToGridId(n: number, gridSize: Vec3) {
  let x = Math.floor(n / (gridSize[1] * gridSize[2]));
  let y = Math.floor((n % (gridSize[1] * gridSize[2])) / gridSize[2]);
  let z = (n % (gridSize[1] * gridSize[2])) % gridSize[2];
  return { x, y, z };
}

const gridSize: Vec3 = [1, 1, 2];

for (let i = 0; i < gridSize[0] * gridSize[1] * gridSize[2]; i++) {
  console.log(i, idToGridId(i, gridSize));
}
