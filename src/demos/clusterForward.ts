import { canvasCtx, canvasFormat, device, queue } from '../context';
import { GenOptions, Refs } from '../ui';
import { createBuffer, degToRad, Demo } from './demo';
import FrustumVertCode from '../shaders/frustum.vert.wgsl?raw';
import FrustumFragCode from '../shaders/frustum.frag.wgsl?raw';
import ClusterAllInOneCode from '../shaders/cluster.all-in-one.wgsl?raw';
import { mat4 } from 'gl-matrix';
import { cubePrimitives } from '../assets/boxPrimitivs';
import * as BBO from 'buffer-backed-object';

const BBOVec3 = BBO.NestedBufferBackedObject({
  x: BBO.Float32(),
  y: BBO.Float32(),
  z: BBO.Float32(),
});

const vfov = degToRad(45);
const DEPTH_FORMAT = 'depth24plus';
const DepthSplitMethod: { [k: string]: number } = {
  'ndc-space-even': 0, // screen space uneven
  'view-space-even': 1, // screen space uneven
  'DOOM-2016-Siggraph': 2, // screen space even
};

type Params = {
  output: { value: string; options: string[]; onChange: (v: string) => void };
  clusterSize: { value: Vec3; range: Vec2; onChange: (v: Vec3) => void };
  lightNum: { value: number; range: Vec2; onChange: (v: number) => void };
  maxLightPerCluster: { value: number; range: Vec2; onChange: (v: number) => void };
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

  debugViewport: Vec4 = [0, 0, 1, 1];
  viewport: Vec4 = [0, 0, 1, 1];
  debugCameraPosition: Vec3 = [0, 0, 4];
  debugCameraXYPlaneDeg = 0;
  debugCameraXYPlaneRadius = 1;

  params!: Params;
  viewportSpliter = new ViewportSpliter();
  depthTexture!: GPUTexture;
  depthTextureView!: GPUTextureView;
  bindGroupEntries = {
    view: {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
      buffer: {},
    } as GPUBindGroupLayoutEntry,
    frustum: {
      binding: 1,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
      buffer: {},
    } as GPUBindGroupLayoutEntry,
    clusterBounds: {
      binding: 2,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' },
    } as GPUBindGroupLayoutEntry,
    globalLights: {
      binding: 3,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'read-only-storage' },
    } as GPUBindGroupLayoutEntry,
    clusterLights: {
      binding: 4,
      visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
      buffer: { type: 'storage' },
    } as GPUBindGroupLayoutEntry,
    clusterIndices: {
      binding: 5,
      visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
      buffer: { type: 'storage' },
    } as GPUBindGroupLayoutEntry,
  };
  bindGroupLayouts!: {
    frustum: GPUBindGroupLayout;
    clusterBounds: GPUBindGroupLayout;
    clusterLights: GPUBindGroupLayout;
  };
  pipelines!: {
    frustum: GPURenderPipeline;
    clusterBounds: GPUComputePipeline;
    clusterLights: GPUComputePipeline;
  };
  bindGroups!: { frustum: GPUBindGroup; clusterBounds: GPUBindGroup; clusterLights: GPUBindGroup };
  // prettier-ignore
  bufferCreator!: {
    view: () => {
      gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {
        matrix: Float32Array; // camera's world matrix invert
        projection: Float32Array; zRange: Float32Array;
      };
    }; frustum: () => { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: { mapping: Float32Array; projection: Float32Array; clusterSize: Uint32Array; depthSplitMethod: Uint32Array; }; }; clusterBounds: () => { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {}; }; globalLights: () => { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: BBO.DecodedBuffer<{ ambient: BBO.Descriptor<BBO.DecodedBuffer<{ x: BBO.Descriptor<number>; y: BBO.Descriptor<number>; z: BBO.Descriptor<number>; }>>; lightCount: BBO.Descriptor<number>; lights: BBO.Descriptor<BBO.DecodedBuffer<{ position: BBO.Descriptor<BBO.DecodedBuffer<{ x: BBO.Descriptor<number>; y: BBO.Descriptor<number>; z: BBO.Descriptor<number>; }>>; range: BBO.Descriptor<number>; color: BBO.Descriptor<BBO.DecodedBuffer<{ x: BBO.Descriptor<number>; y: BBO.Descriptor<number>; z: BBO.Descriptor<number>; }>>; intensity: BBO.Descriptor<number>; }>[]>; }>; }; clusterLights: () => { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: BBO.DecodedBuffer<{ offset: BBO.Descriptor<number>; lights: BBO.Descriptor<BBO.DecodedBuffer<{ offset: BBO.Descriptor<number>; count: BBO.Descriptor<number>; }>[]>; }>; }; clusterIndices: () => { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: BBO.DecodedBuffer<{ indices: BBO.Descriptor<BBO.DecodedBuffer<{ x: BBO.Descriptor<number>; }>[]>; }>; }; cubeVertex: () => { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {}; }; cubeIndices: () => { gpuBuffer: GPUBuffer; cpuBuffer: Uint32Array; view: {}; };
  };
  // prettier-ignore
  buffers!: {
    view: {
      gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {
        matrix: Float32Array; // camera's world matrix invert
        projection: Float32Array; zRange: Float32Array;
      };
    }; frustum: { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: { mapping: Float32Array; projection: Float32Array; clusterSize: Uint32Array; depthSplitMethod: Uint32Array; }; }; clusterBounds: { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {}; }; globalLights: { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: BBO.DecodedBuffer<{ ambient: BBO.Descriptor<BBO.DecodedBuffer<{ x: BBO.Descriptor<number>; y: BBO.Descriptor<number>; z: BBO.Descriptor<number>; }>>; lightCount: BBO.Descriptor<number>; lights: BBO.Descriptor<BBO.DecodedBuffer<{ position: BBO.Descriptor<BBO.DecodedBuffer<{ x: BBO.Descriptor<number>; y: BBO.Descriptor<number>; z: BBO.Descriptor<number>; }>>; range: BBO.Descriptor<number>; color: BBO.Descriptor<BBO.DecodedBuffer<{ x: BBO.Descriptor<number>; y: BBO.Descriptor<number>; z: BBO.Descriptor<number>; }>>; intensity: BBO.Descriptor<number>; }>[]>; }>; }; clusterLights: { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: BBO.DecodedBuffer<{ offset: BBO.Descriptor<number>; lights: BBO.Descriptor<BBO.DecodedBuffer<{ offset: BBO.Descriptor<number>; count: BBO.Descriptor<number>; }>[]>; }>; }; clusterIndices: { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: BBO.DecodedBuffer<{ indices: BBO.Descriptor<BBO.DecodedBuffer<{ x: BBO.Descriptor<number>; }>[]>; }>; }; cubeVertex: { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {}; }; cubeIndices: { gpuBuffer: GPUBuffer; cpuBuffer: Uint32Array; view: {}; };
  };
  gpuJobs!: {
    drawFrustum: (passEncoder: GPURenderPassEncoder) => void;
    computeClusterBounds: () => void;
    computeClusterLights: () => void;
  };
  cpuJobs!: { drawFrustum: () => void };

  async init(refs: Refs, genOptions: GenOptions): Promise<void> {
    this.disposed = false;
    this.initUI(refs, genOptions);

    const shaderAllInOne = device.createShaderModule({ code: ClusterAllInOneCode });
    this.bindGroupLayouts = {
      frustum: device.createBindGroupLayout({
        entries: [
          this.bindGroupEntries.view,
          this.bindGroupEntries.frustum,
          this.bindGroupEntries.clusterLights,
          this.bindGroupEntries.clusterIndices,
        ],
      }),
      clusterBounds: device.createBindGroupLayout({
        entries: [
          this.bindGroupEntries.view,
          this.bindGroupEntries.frustum,
          this.bindGroupEntries.clusterBounds,
        ],
      }),
      clusterLights: device.createBindGroupLayout({
        entries: [
          this.bindGroupEntries.view,
          this.bindGroupEntries.frustum,
          this.bindGroupEntries.clusterBounds,
          this.bindGroupEntries.globalLights,
          this.bindGroupEntries.clusterLights,
          this.bindGroupEntries.clusterIndices,
        ],
      }),
    };
    this.bufferCreator = {
      view: () => {
        const cpuBuffer = new Float32Array(16 + 16 + 2);
        const view = {
          matrix: new Float32Array(cpuBuffer.buffer, 0, 16), // camera's world matrix invert
          projection: new Float32Array(cpuBuffer.buffer, 16 * 4, 16),
          zRange: new Float32Array(cpuBuffer.buffer, 16 * 2 * 4, 2),
        };
        const gpuBuffer = createBuffer(
          cpuBuffer,
          GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          false,
        );
        return { gpuBuffer, cpuBuffer, view };
      },
      frustum: () => {
        const cpuBuffer = new Float32Array(16 + 16 + 4);
        const view = {
          mapping: new Float32Array(cpuBuffer.buffer, 0, 16),
          projection: new Float32Array(cpuBuffer.buffer, 16 * 4, 16),
          clusterSize: new Uint32Array(cpuBuffer.buffer, 16 * 4 * 2, 3),
          depthSplitMethod: new Uint32Array(cpuBuffer.buffer, 16 * 4 * 2 + 3 * 4, 1),
        };
        view.clusterSize.set(this.params.clusterSize.value);
        const gpuBuffer = createBuffer(
          cpuBuffer,
          GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          false,
        );
        return { gpuBuffer, cpuBuffer, view };
      },
      clusterBounds: () => {
        const { clusterLen } = this.getClusterSize();
        const cpuBuffer = new Float32Array(16 * clusterLen);
        const view = {};
        const gpuBuffer = createBuffer(
          cpuBuffer,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          false,
        );
        return { gpuBuffer, cpuBuffer, view };
      },
      globalLights: () => {
        const lightCount = this.params.lightNum.value;
        const structDesc = {
          ambient: BBOVec3,
          lightCount: BBO.Uint32(),
          lights: BBO.NestedArrayOfBufferBackedObjects(lightCount, {
            position: BBOVec3,
            range: BBO.Float32(),
            color: BBOVec3,
            intensity: BBO.Float32(),
          }),
        };
        const structGlobalLightSize = BBO.structSize(structDesc);
        console.log(structGlobalLightSize);

        const cpuBuffer = new Uint8Array(structGlobalLightSize);
        const view = BBO.BufferBackedObject(cpuBuffer.buffer, structDesc);
        const gpuBuffer = createBuffer(
          cpuBuffer,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          false,
        );
        return { gpuBuffer, cpuBuffer, view };
      },
      clusterLights: () => {
        const { clusterLen } = this.getClusterSize();
        const structDesc = {
          offset: BBO.Uint32(),
          lights: BBO.NestedArrayOfBufferBackedObjects(clusterLen, {
            offset: BBO.Uint32(),
            count: BBO.Uint32(),
          }),
        };
        const structClusterLightsSize = BBO.structSize(structDesc);
        console.log(structClusterLightsSize);

        const cpuBuffer = new Uint8Array(structClusterLightsSize);
        const view = BBO.BufferBackedObject(cpuBuffer.buffer, structDesc);
        const gpuBuffer = createBuffer(
          cpuBuffer,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          false,
        );
        return { gpuBuffer, cpuBuffer, view };
      },
      clusterIndices: () => {
        const { clusterLen } = this.getClusterSize();
        const maxLightPerCluster = this.params.maxLightPerCluster.value;
        const structDesc = {
          indices: BBO.NestedArrayOfBufferBackedObjects(maxLightPerCluster * clusterLen, {
            x: BBO.Uint32(),
          }),
        };
        const structClusterLightsSize = BBO.structSize(structDesc);
        console.log(structClusterLightsSize);

        const cpuBuffer = new Uint8Array(structClusterLightsSize);
        const view = BBO.BufferBackedObject(cpuBuffer.buffer, structDesc);
        const gpuBuffer = createBuffer(
          cpuBuffer,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          false,
        );
        return { gpuBuffer, cpuBuffer, view };
      },
      cubeVertex: () => {
        const cpuBuffer = new Float32Array(cubePrimitives.position);
        const view = {};
        const gpuBuffer = createBuffer(cpuBuffer, GPUBufferUsage.VERTEX, true);
        return { gpuBuffer, cpuBuffer, view };
      },
      cubeIndices: () => {
        const cpuBuffer = new Uint32Array(cubePrimitives.indices);
        const view = {};
        const gpuBuffer = createBuffer(cpuBuffer, GPUBufferUsage.INDEX, true);
        return { gpuBuffer, cpuBuffer, view };
      },
    };
    this.buffers = {
      view: this.bufferCreator.view(),
      frustum: this.bufferCreator.frustum(),
      clusterBounds: this.bufferCreator.clusterBounds(),
      globalLights: this.bufferCreator.globalLights(),
      clusterLights: this.bufferCreator.clusterLights(),
      clusterIndices: this.bufferCreator.clusterIndices(),
      cubeVertex: this.bufferCreator.cubeVertex(),
      cubeIndices: this.bufferCreator.cubeIndices(),
    };
    this.pipelines = {
      frustum: device.createRenderPipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this.bindGroupLayouts.frustum],
        }),
        vertex: {
          entryPoint: 'frustumVertex',
          module: shaderAllInOne,
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
          entryPoint: 'frustumFragment',
          module: shaderAllInOne,
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
          depthWriteEnabled: false,
          depthCompare: 'less',
        },
      }),
      clusterBounds: device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this.bindGroupLayouts.clusterBounds],
        }),
        compute: {
          module: shaderAllInOne,
          entryPoint: 'computeClusterBounds',
        },
      }),
      clusterLights: device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this.bindGroupLayouts.clusterLights],
        }),
        compute: {
          module: shaderAllInOne,
          entryPoint: 'computeClusterLights',
        },
      }),
    };
    const entry = (name: keyof typeof this.bindGroupEntries): GPUBindGroupEntry => ({
      binding: this.bindGroupEntries[name].binding,
      resource: { buffer: this.buffers[name].gpuBuffer },
    });
    this.bindGroups = {
      frustum: device.createBindGroup({
        layout: this.bindGroupLayouts.frustum,
        entries: [entry('view'), entry('frustum'), entry('clusterLights'), entry('clusterIndices')],
      }),
      clusterBounds: device.createBindGroup({
        layout: this.bindGroupLayouts.clusterBounds,
        entries: [entry('view'), entry('frustum'), entry('clusterBounds')],
      }),
      clusterLights: device.createBindGroup({
        layout: this.bindGroupLayouts.clusterLights,
        entries: [
          entry('view'),
          entry('frustum'),
          entry('clusterBounds'),
          entry('globalLights'),
          entry('clusterIndices'),
          entry('clusterLights'),
        ],
      }),
    };
    this.cpuJobs = {
      drawFrustum: () => {
        this.debugCameraXYPlaneDeg = (this.debugCameraXYPlaneDeg + 1) % 360;
        if (this.params.animateCamera.value) {
          this.debugCameraPosition[0] =
            Math.cos(degToRad(this.debugCameraXYPlaneDeg)) * this.debugCameraXYPlaneRadius;
          this.debugCameraPosition[1] =
            Math.sin(degToRad(this.debugCameraXYPlaneDeg)) * this.debugCameraXYPlaneRadius;
        } else {
          this.debugCameraPosition[0] = 0;
          this.debugCameraPosition[1] = 0;
        }
        if (this.params.aerialView.value) {
          this.debugCameraPosition[0] = 0;
          this.debugCameraPosition[1] = 28;
        }
        this.buffers.frustum.view.depthSplitMethod[0] =
          DepthSplitMethod[this.params.frustumDepth.value] || 0;
      },
    };
    this.gpuJobs = {
      drawFrustum: (passEncoder: GPURenderPassEncoder) => {
        const { clusterLen } = this.getClusterSize();
        const instanceRange = [0, clusterLen];
        // const instanceRange = [3, 4];
        passEncoder.setPipeline(this.pipelines.frustum);
        passEncoder.setBindGroup(0, this.bindGroups.frustum);
        passEncoder.setVertexBuffer(0, this.buffers.cubeVertex.gpuBuffer);
        passEncoder.setIndexBuffer(this.buffers.cubeIndices.gpuBuffer, 'uint32');
        passEncoder.drawIndexed(36, instanceRange[1] - instanceRange[0], 0, 0, instanceRange[0]);
      },
      computeClusterBounds: () => {
        const { clusterLen } = this.getClusterSize();
        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipelines.clusterBounds);
        passEncoder.setBindGroup(0, this.bindGroups.clusterBounds);
        passEncoder.dispatchWorkgroups(Math.ceil(clusterLen / 64));
        passEncoder.end();
        queue.submit([commandEncoder.finish()]);
      },
      computeClusterLights: () => {
        const { clusterLen } = this.getClusterSize();
        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipelines.clusterLights);
        passEncoder.setBindGroup(0, this.bindGroups.clusterLights);
        passEncoder.dispatchWorkgroups(Math.ceil(clusterLen / 64));
        passEncoder.end();
        queue.submit([commandEncoder.finish()]);
      },
    };

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
        value: [2, 2, 4],
        range: [1, 32],
        onChange: (v: [number, number, number]) => {
          this.buffers.frustum.view.clusterSize.set(v);
        },
      },
      lightNum: {
        value: 1,
        range: [1, 1000],
        onChange: (v: number) => {},
      },
      maxLightPerCluster: {
        value: 100,
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
        options: ['ndc-space-even', 'view-space-even', 'DOOM-2016-Siggraph'],
        onChange: (v: string) => {},
      },
      animateCamera: {
        value: true,
        onChange: (v: boolean) => {},
      },
      aerialView: {
        value: false,
        onChange: (v: boolean) => {},
      },
    };
    genOptions(this.params);
  }

  getClusterSize() {
    const clusterSize = this.params.clusterSize.value;
    const clusterLen = clusterSize[0] * clusterSize[1] * clusterSize[2];
    return { clusterSize, clusterLen };
  }

  updateCamera() {
    const [, , w, h] = this.renderFinal ? this.viewport : this.debugViewport;
    const { zRange } = this.params;
    const [near, far] = zRange.value;
    const { view, frustum } = this.buffers;

    // this.camera.far = far;
    // this.camera.near = near;
    // this.camera.aspect = w / h;
    // this.debugCamera.aspect = w / h;
    // this.camera.updateMatrix();
    // this.debugCamera.updateMatrix();

    // view.view.projection.set(this.debugCamera.projection);
    // frustum.view.mapping.set(this.camera.mapping);
    // frustum.view.projection.set(this.camera.projection);

    mat4.perspectiveZO(view.view.projection, vfov, w / h, 1, 1000);
    mat4.perspectiveZO(frustum.view.projection, vfov, w / h, near, far);
    mat4.invert(frustum.view.mapping, frustum.view.projection);

    mat4.targetTo(view.view.matrix, this.debugCameraPosition, [0, 0, -near], [0, 1, 0]);
    mat4.invert(view.view.matrix, view.view.matrix);

    view.view.zRange.set(zRange.value);
  }

  allocateViewports() {
    this.viewportSpliter.reset(Number(this.renderFinal) + Number(this.renderFrustum));

    if (this.renderFinal) this.viewport = this.viewportSpliter.getViewport();
    if (this.renderFrustum) this.debugViewport = this.viewportSpliter.getViewport();
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

    this.cpuJobs.drawFrustum();
    this.updateCamera();
    queue.writeBuffer(this.buffers.frustum.gpuBuffer, 0, this.buffers.frustum.cpuBuffer);
    queue.writeBuffer(this.buffers.view.gpuBuffer, 0, this.buffers.view.cpuBuffer);

    if (this.renderFinal) {
      passEncoder.setViewport(...this.viewport, 0, 1);
      passEncoder.setScissorRect(...this.viewport);
    }
    if (this.renderFrustum) {
      passEncoder.setViewport(...this.debugViewport, 0, 1);
      passEncoder.setScissorRect(...this.debugViewport);
      this.gpuJobs.drawFrustum(passEncoder);
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

/// test

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
