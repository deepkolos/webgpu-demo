import { canvasCtx, canvasFormat, device, queue } from '../context';
import { GenOptions, Refs } from '../ui';
import { createBuffer, degToRad, Demo, getRotateAxis, randomBetween, sleep } from './demo';
import ClusterAllInOneCode from '../shaders/cluster.all-in-one.wgsl?raw';
import { mat3, mat4, quat, vec3, vec4 } from 'gl-matrix';
import { cubePrimitives } from '../assets/boxPrimitives';
import * as BBO from 'buffer-backed-object';
import { spherePrimitives } from '../assets/spherePrimitives';
import preview from '../assets/screenshots/clusterforward.png'

const colors = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
  [0, 1, 1],
  [1, 0, 1],
  [1, 1, 1],
];

// https://github.com/GoogleChromeLabs/buffer-backed-object/issues/37
const BBOVec3 = () => BBO.NestedBufferBackedObject({
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
  // output: { value: string; options: string[]; onChange: (v: string) => void };
  clusterSize: { value: Vec3; range: Vec2; onChange: (v: Vec3) => void };
  lightNum: { value: number; range: Vec2; onChange: (v: number) => void };
  maxLightRange: { value: number; range: Vec2; step: number; onChange: (v: number) => void };
  maxLightPerCluster: { value: number; range: Vec2; onChange: (v: number) => void };
  zRange: { value: Vec2; range: Vec2; onChange: (v: Vec2) => void };
  animateCamera: { value: boolean; onChange: (v: boolean) => void };
  aerialView: { value: boolean; onChange: (v: boolean) => void };
  drawLightSprite: { value: boolean; onChange: (v: boolean) => void };
  frustumDepth: { value: string; options: string[]; onChange: (v: string) => void };
};

export class DemoClusterForward implements Demo {
  name = 'ClusterForward';
  preview = preview;

  renderFrustum = true;
  renderFinal = true;
  disposed = false;

  debugViewport: Vec4 = [0, 0, 1, 1];
  viewport: Vec4 = [0, 0, 1, 1];
  debugCameraPosition: Vec3 = [0, 0, 4];
  debugCameraXYPlaneDeg = 0;
  debugCameraXYPlaneRadius = 15;
  clusterBoundsNeedUpdate = true;
  printComputeResults = true;

  params!: Params;
  viewportSpliter = new ViewportSpliter();
  depthTexture!: GPUTexture;
  depthTextureView!: GPUTextureView;
  bindGroupEntries = {
    view: {
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
      buffer: {},
    } as GPUBindGroupLayoutEntry,
    frustum: {
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
      buffer: {},
    } as GPUBindGroupLayoutEntry,
    clusterBounds: {
      binding: 2,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' },
    } as GPUBindGroupLayoutEntry,
    globalLights: {
      binding: 3,
      visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
      buffer: { type: 'read-only-storage' },
    } as GPUBindGroupLayoutEntry,
    clusterLights: {
      binding: 4,
      visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' },
    } as GPUBindGroupLayoutEntry,
    clusterIndices: {
      binding: 5,
      visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' },
    } as GPUBindGroupLayoutEntry,
  };
  bindGroupLayouts!: {
    frustum: GPUBindGroupLayout;
    clusterBounds: GPUBindGroupLayout;
    clusterLights: GPUBindGroupLayout;
    lightSprite: GPUBindGroupLayout;
    sphere: GPUBindGroupLayout;
  };
  pipelines!: {
    frustum: GPURenderPipeline;
    clusterBounds: GPUComputePipeline;
    clusterLights: GPUComputePipeline;
    lightSprite: GPURenderPipeline;
    sphere: GPURenderPipeline;
  };
  bindGroups!: {
    frustum: GPUBindGroup;
    clusterBounds: GPUBindGroup;
    clusterLights: GPUBindGroup;
    lightSprite: GPUBindGroup;
    sphere: GPUBindGroup;
  };
  gpuJobs!: {
    drawFrustum: (passEncoder: GPURenderPassEncoder) => void;
    drawLightSprite: (passEncoder: GPURenderPassEncoder) => void;
    drawSphere: (passEncoder: GPURenderPassEncoder) => void;
    computeClusterBounds: () => void;
    computeClusterLights: () => void;
  };
  cpuJobs!: { drawFrustum: () => void; updateLightPosition: () => void };
  bindGroupsCreator!: {
    frustum: () => GPUBindGroup;
    clusterBounds: () => GPUBindGroup;
    clusterLights: () => GPUBindGroup;
    lightSprite: () => GPUBindGroup;
    sphere: () => GPUBindGroup;
  };
  // prettier-ignore
  bufferCreator!: {
    view: () => {
      gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {
        matrix: Float32Array; // camera's world matrix invert
        projection: Float32Array; zRange: Float32Array;
      };
    }; frustum: () => { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: { mapping: Float32Array; projection: Float32Array; clusterSize: Uint32Array; depthSplitMethod: Uint32Array; }; }; clusterBounds: () => { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: { bounds: { minAABB: Float32Array; maxAABB: Float32Array; }[]; }; stagingBuffer: GPUBuffer; read: () => Promise<void>; }; globalLights: () => { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: { ambient: Float32Array; lightCount: Uint32Array; lights: { position: Float32Array; range: Float32Array; color: Float32Array; intensity: Float32Array; }[]; }; }; clusterLights: () => { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: { offset: Uint32Array; lights: { offset: Uint32Array; count: Uint32Array; }[]; }; stagingBuffer: GPUBuffer; read: () => Promise<void>; }; clusterIndices: () => { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: Uint32Array; stagingBuffer: GPUBuffer; read: () => Promise<void>; }; cubeVertex: () => { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {}; }; cubeIndices: () => { gpuBuffer: GPUBuffer; cpuBuffer: Uint32Array; view: {}; }; cubeNormal: () => { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {}; }; sphereVertex: () => { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {}; }; sphereIndices: () => { gpuBuffer: GPUBuffer; cpuBuffer: Uint32Array; view: {}; }; sphereNormal: () => { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {}; };
  };
  // prettier-ignore
  buffers!: {
    view: {
      gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {
        matrix: Float32Array; // camera's world matrix invert
        projection: Float32Array; zRange: Float32Array;
      };
    }; frustum: { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: { mapping: Float32Array; projection: Float32Array; clusterSize: Uint32Array; depthSplitMethod: Uint32Array; }; }; clusterBounds: { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: { bounds: { minAABB: Float32Array; maxAABB: Float32Array; }[]; }; stagingBuffer: GPUBuffer; read: () => Promise<void>; }; globalLights: { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: { ambient: Float32Array; lightCount: Uint32Array; lights: { position: Float32Array; range: Float32Array; color: Float32Array; intensity: Float32Array; }[]; }; }; clusterLights: { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: { offset: Uint32Array; lights: { offset: Uint32Array; count: Uint32Array; }[]; }; stagingBuffer: GPUBuffer; read: () => Promise<void>; }; clusterIndices: { gpuBuffer: GPUBuffer; cpuBuffer: Uint8Array; view: Uint32Array; stagingBuffer: GPUBuffer; read: () => Promise<void>; }; cubeVertex: { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {}; }; cubeIndices: { gpuBuffer: GPUBuffer; cpuBuffer: Uint32Array; view: {}; }; cubeNormal: { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {}; }; sphereVertex: { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {}; }; sphereIndices: { gpuBuffer: GPUBuffer; cpuBuffer: Uint32Array; view: {}; }; sphereNormal: { gpuBuffer: GPUBuffer; cpuBuffer: Float32Array; view: {}; };
  };

  initUI(refs: Refs, genOptions: GenOptions) {
    this.params = {
      // output: {
      //   value: 'cluster-grid',
      //   options: ['cluster-grid', 'cluster-depth', 'cluster-light', 'final'],
      //   onChange: (v: string) => {},
      // },
      clusterSize: {
        value: [32, 32, 32],
        range: [1, 32],
        onChange: (v: [number, number, number]) => {
          this.buffers.frustum.view.clusterSize.set(v);
          this.buffers.clusterBounds = this.bufferCreator.clusterBounds();
          this.buffers.clusterIndices = this.bufferCreator.clusterIndices();
          this.buffers.clusterLights = this.bufferCreator.clusterLights();
          this.bindGroups.clusterBounds = this.bindGroupsCreator.clusterBounds();
          this.bindGroups.clusterLights = this.bindGroupsCreator.clusterLights();
          this.bindGroups.frustum = this.bindGroupsCreator.frustum();
          this.bindGroups.sphere = this.bindGroupsCreator.sphere();
          this.clusterBoundsNeedUpdate = true;
          this.printComputeResults = true;
        },
      },
      lightNum: {
        value: 20,
        range: [1, 1000],
        onChange: (v: number) => {
          this.buffers.globalLights = this.bufferCreator.globalLights();
          this.bindGroups.clusterLights = this.bindGroupsCreator.clusterLights();
          this.bindGroups.lightSprite = this.bindGroupsCreator.lightSprite();
          this.bindGroups.sphere = this.bindGroupsCreator.sphere();
          this.printComputeResults = true;
        },
      },
      maxLightPerCluster: {
        value: 100,
        range: [1, 100],
        onChange: (v: number) => {},
      },
      maxLightRange: {
        value: 2,
        range: [-1, 10],
        step: 0.2,
        onChange: (v: number) => {
          const { view, gpuBuffer, cpuBuffer } = this.buffers.globalLights;
          view.lights.forEach(light => {
            light.range[0] = v;
          });
          queue.writeBuffer(gpuBuffer, 0, cpuBuffer);
          this.printComputeResults = true;
        },
      },
      zRange: {
        value: [1, 10],
        range: [0.01, 10000],
        onChange: (v: Vec2) => {},
      },
      frustumDepth: {
        value: 'DOOM-2016-Siggraph',
        // value: 'ndc-space-even',
        // value: 'view-space-even',
        options: ['ndc-space-even', 'view-space-even', 'DOOM-2016-Siggraph'],
        onChange: (v: string) => {
          this.clusterBoundsNeedUpdate = true;
          this.printComputeResults = true;
        },
      },
      animateCamera: { value: true, onChange: (v: boolean) => {} },
      aerialView: { value: false, onChange: (v: boolean) => {} },
      drawLightSprite: { value: false, onChange: (v: boolean) => {} },
    };
    genOptions(this.params);
  }

  async init(refs: Refs, genOptions: GenOptions): Promise<void> {
    this.disposed = false;
    this.initUI(refs, genOptions);
    this.clusterBoundsNeedUpdate = true;
    this.printComputeResults = true;

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
      lightSprite: device.createBindGroupLayout({
        entries: [
          this.bindGroupEntries.view,
          this.bindGroupEntries.frustum,
          this.bindGroupEntries.globalLights,
        ],
      }),
      sphere: device.createBindGroupLayout({
        entries: [
          this.bindGroupEntries.view,
          this.bindGroupEntries.frustum,
          this.bindGroupEntries.clusterLights,
          this.bindGroupEntries.clusterIndices,
          this.bindGroupEntries.globalLights,
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
        const boundSize = 4 * 4 * 2;
        const cpuBuffer = new Uint8Array(boundSize * clusterLen);
        const view = {
          bounds: new Array(clusterLen).fill(0).map((v, k) => ({
            minAABB: new Float32Array(cpuBuffer.buffer, boundSize * k, 3),
            maxAABB: new Float32Array(cpuBuffer.buffer, boundSize * k + 4 * 4, 3),
          })),
        };
        const gpuBuffer = createBuffer(
          cpuBuffer,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
          false,
        );
        const stagingBuffer = createBuffer(
          cpuBuffer,
          GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
          false,
        );
        const read = async () => {
          await stagingBuffer.mapAsync(GPUMapMode.READ);
          cpuBuffer.set(new Uint8Array(stagingBuffer.getMappedRange(0, cpuBuffer.byteLength)));
          stagingBuffer.unmap();
        };
        return { gpuBuffer, cpuBuffer, view, stagingBuffer, read };
      },
      globalLights: () => {
        const [near, far] = this.params.zRange.value;
        const zRange = far - near;
        const lightCount = this.params.lightNum.value;
        const lightDesc = {
          position: BBOVec3(),
          range: BBO.Float32(),
          color: BBOVec3(),
          intensity: BBO.Float32(),
        };
        const structDesc = {
          ambient: BBOVec3(),
          lightCount: BBO.Uint32(),
          lights: BBO.NestedArrayOfBufferBackedObjects(lightCount, lightDesc),
        };
        const lightSize = BBO.structSize(lightDesc);
        const cpuBuffer = new Uint8Array(BBO.structSize(structDesc));
        const view = {
          ambient: new Float32Array(cpuBuffer.buffer, 0, 3),
          lightCount: new Uint32Array(cpuBuffer.buffer, 4 * 3, 1),
          lights: new Array(lightCount).fill(0).map((v, k) => ({
            position: new Float32Array(cpuBuffer.buffer, 4 * 4 + lightSize * k, 3),
            range: new Float32Array(cpuBuffer.buffer, 4 * 4 + lightSize * k + 4 * 3, 1),
            color: new Float32Array(cpuBuffer.buffer, 4 * 4 + lightSize * k + 4 * (3 + 1), 3),
            intensity: new Float32Array(
              cpuBuffer.buffer,
              4 * 4 + lightSize * k + 4 * (3 + 1 + 3),
              1,
            ),
            rotateAxis: vec3.create(),
            rotateSpeed: randomBetween(0.5, 2.5),
          })),
        };
        view.lightCount[0] = lightCount;
        view.lights.forEach(light => {
          light.position.set([
            randomBetween(-3, 3),
            randomBetween(-3, 3),
            -randomBetween(near + zRange * 0.25, near + zRange * 0.6),
            // 0, 0, -3.2,
          ]);
          // light.color.set([randomBetween(0.1, 1), randomBetween(0.1, 1), randomBetween(0.1, 1)]);
          light.color.set(colors[~~randomBetween(0, colors.length - 1)]);
          // light.color.set([1, 1, 1]);
          light.intensity[0] = 1;
          light.range[0] = this.params.maxLightRange.value;
          // light.range[0] = -1;
          const direction = vec3.fromValues(
            randomBetween(0.1, 1),
            randomBetween(0.1, 1),
            randomBetween(0.1, 1),
          );
          vec3.normalize(direction, direction);
          getRotateAxis(
            light.rotateAxis,
            [0, 0, -(near + zRange * 0.5)],
            light.position,
            direction,
          );
        });
        view.lights[0].color.set([1, 0, 0]);
        view.lights[0].position.set([0, -1, -3.2]);

        view.lights[1]?.color.set([0, 0, 1]);
        view.lights[1]?.position.set([0, 1, -3.2]);
        console.log('globalLights', view);

        const gpuBuffer = createBuffer(
          cpuBuffer,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          true,
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
        const lightSize = 2 * 4;
        const cpuBuffer = new Uint8Array(structClusterLightsSize);
        const view = {
          offset: new Uint32Array(cpuBuffer.buffer, 0, 1),
          lights: new Array(clusterLen).fill(0).map((v, k) => ({
            offset: new Uint32Array(cpuBuffer.buffer, 4 * 1 + lightSize * k, 1),
            count: new Uint32Array(cpuBuffer.buffer, 4 * 1 + lightSize * k + 4 * 1, 1),
          })),
        };
        const gpuBuffer = createBuffer(
          cpuBuffer,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
          false,
        );
        const stagingBuffer = createBuffer(
          cpuBuffer,
          GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
          false,
        );
        const read = async () => {
          await stagingBuffer.mapAsync(GPUMapMode.READ);
          cpuBuffer.set(new Uint8Array(stagingBuffer.getMappedRange(0, cpuBuffer.byteLength)));
          stagingBuffer.unmap();
        };
        return { gpuBuffer, cpuBuffer, view, stagingBuffer, read };
      },
      clusterIndices: () => {
        const { clusterLen } = this.getClusterSize();
        const maxLightPerCluster = this.params.maxLightPerCluster.value;
        const structDesc = {
          indices: BBO.NestedArrayOfBufferBackedObjects(maxLightPerCluster * clusterLen, {
            x: BBO.Uint32(),
          }),
        };
        const cpuBuffer = new Uint8Array(BBO.structSize(structDesc));
        const view = new Uint32Array(cpuBuffer.buffer);
        const gpuBuffer = createBuffer(
          cpuBuffer,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
          false,
        );
        const stagingBuffer = createBuffer(
          cpuBuffer,
          GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
          false,
        );
        const read = async () => {
          await stagingBuffer.mapAsync(GPUMapMode.READ);
          cpuBuffer.set(new Uint8Array(stagingBuffer.getMappedRange(0, cpuBuffer.byteLength)));
          stagingBuffer.unmap();
        };
        return { gpuBuffer, cpuBuffer, view, stagingBuffer, read };
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
      cubeNormal: () => {
        const cpuBuffer = new Float32Array(cubePrimitives.normal);
        const view = {};
        const gpuBuffer = createBuffer(cpuBuffer, GPUBufferUsage.VERTEX, true);
        return { gpuBuffer, cpuBuffer, view };
      },
      sphereVertex: () => {
        const cpuBuffer = new Float32Array(spherePrimitives.position);
        const gpuBuffer = createBuffer(cpuBuffer, GPUBufferUsage.VERTEX, true);
        return { gpuBuffer, cpuBuffer, view: {} };
      },
      sphereIndices: () => {
        const cpuBuffer = new Uint32Array(spherePrimitives.indices);
        const gpuBuffer = createBuffer(cpuBuffer, GPUBufferUsage.INDEX, true);
        return { gpuBuffer, cpuBuffer, view: {} };
      },
      sphereNormal: () => {
        const cpuBuffer = new Float32Array(spherePrimitives.normal);
        const gpuBuffer = createBuffer(cpuBuffer, GPUBufferUsage.VERTEX, true);
        return { gpuBuffer, cpuBuffer, view: {} };
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
      cubeNormal: this.bufferCreator.cubeNormal(),
      sphereVertex: this.bufferCreator.sphereVertex(),
      sphereIndices: this.bufferCreator.sphereIndices(),
      sphereNormal: this.bufferCreator.sphereNormal(),
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
            // {
            //   arrayStride: 4 * 3,
            //   stepMode: 'vertex',
            //   attributes: [
            //     { shaderLocation: 1, offset: 0, format: 'float32x3' }, // normal
            //   ],
            // },
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
          depthWriteEnabled: true,
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
      lightSprite: device.createRenderPipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this.bindGroupLayouts.lightSprite],
        }),
        vertex: { module: shaderAllInOne, entryPoint: 'lightSpriteVertex' },
        fragment: {
          module: shaderAllInOne,
          entryPoint: 'lightSpriteFragment',
          targets: [{ format: canvasFormat }],
        },
        depthStencil: {
          format: DEPTH_FORMAT,
        },
      }),
      sphere: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayouts.sphere] }),
        vertex: {
          entryPoint: 'sphereVertex',
          module: shaderAllInOne,
          buffers: [
            {
              arrayStride: 4 * 3,
              stepMode: 'vertex',
              attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
              ],
            },
            {
              arrayStride: 4 * 3,
              stepMode: 'vertex',
              attributes: [
                { shaderLocation: 1, offset: 0, format: 'float32x3' }, // normal
              ],
            },
          ],
        },
        fragment: {
          entryPoint: 'sphereFragment',
          module: shaderAllInOne,
          targets: [{ format: canvasFormat }],
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
      }),
    };
    const entry = (name: keyof typeof this.bindGroupEntries): GPUBindGroupEntry => ({
      binding: this.bindGroupEntries[name].binding,
      resource: { buffer: this.buffers[name].gpuBuffer },
    });
    this.bindGroupsCreator = {
      frustum: () =>
        device.createBindGroup({
          layout: this.bindGroupLayouts.frustum,
          entries: [
            entry('view'),
            entry('frustum'),
            entry('clusterLights'),
            entry('clusterIndices'),
          ],
        }),
      clusterBounds: () =>
        device.createBindGroup({
          layout: this.bindGroupLayouts.clusterBounds,
          entries: [entry('view'), entry('frustum'), entry('clusterBounds')],
        }),
      clusterLights: () =>
        device.createBindGroup({
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
      lightSprite: () =>
        device.createBindGroup({
          layout: this.bindGroupLayouts.lightSprite,
          entries: [entry('view'), entry('frustum'), entry('globalLights')],
        }),
      sphere: () =>
        device.createBindGroup({
          layout: this.bindGroupLayouts.sphere,
          entries: [
            entry('view'),
            entry('frustum'),
            entry('globalLights'),
            entry('clusterIndices'),
            entry('clusterLights'),
          ],
        }),
    };
    this.bindGroups = {
      frustum: this.bindGroupsCreator.frustum(),
      clusterBounds: this.bindGroupsCreator.clusterBounds(),
      clusterLights: this.bindGroupsCreator.clusterLights(),
      lightSprite: this.bindGroupsCreator.lightSprite(),
      sphere: this.bindGroupsCreator.sphere(),
    };
    this.cpuJobs = {
      drawFrustum: () => {
        if (this.params.animateCamera.value) {
          this.debugCameraXYPlaneDeg = (this.debugCameraXYPlaneDeg + 1) % 360;
          this.debugCameraPosition[0] =
            Math.cos(degToRad(this.debugCameraXYPlaneDeg)) * this.debugCameraXYPlaneRadius;
          this.debugCameraPosition[1] =
            Math.sin(degToRad(this.debugCameraXYPlaneDeg)) * this.debugCameraXYPlaneRadius;
          this.debugCameraPosition[2] = 4;
        }
        //  else {
        //   this.debugCameraPosition[0] = 0;
        //   this.debugCameraPosition[1] = 0;
        //   this.debugCameraPosition[2] = 4;
        // }
        if (this.params.aerialView.value) {
          this.debugCameraPosition[0] = 0;
          this.debugCameraPosition[1] = 25;
          this.debugCameraPosition[2] = -5;
        }
        this.buffers.frustum.view.depthSplitMethod[0] =
          DepthSplitMethod[this.params.frustumDepth.value] || 0;
      },
      updateLightPosition: () => {
        const q = quat.create();
        this.buffers.globalLights.view.lights.forEach(light => {
          quat.setAxisAngle(q, light.rotateAxis, degToRad(light.rotateSpeed));
          vec3.transformQuat(light.position, light.position, q);
        });
        queue.writeBuffer(
          this.buffers.globalLights.gpuBuffer,
          0,
          this.buffers.globalLights.cpuBuffer,
        );
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
        // passEncoder.setVertexBuffer(1, this.buffers.cubeNormal.gpuBuffer);
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
        commandEncoder.copyBufferToBuffer(
          this.buffers.clusterBounds.gpuBuffer,
          0,
          this.buffers.clusterBounds.stagingBuffer,
          0,
          this.buffers.clusterBounds.gpuBuffer.size,
        );
        queue.submit([commandEncoder.finish()]);
      },
      computeClusterLights: () => {
        this.buffers.clusterLights.view.offset[0] = 0;
        queue.writeBuffer(
          this.buffers.clusterLights.gpuBuffer,
          0,
          this.buffers.clusterLights.cpuBuffer,
        );

        const { clusterLen } = this.getClusterSize();
        const commandEncoder = device.createCommandEncoder();
        // 运算之前把offset清0
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipelines.clusterLights);
        passEncoder.setBindGroup(0, this.bindGroups.clusterLights);
        passEncoder.dispatchWorkgroups(Math.ceil(clusterLen / 64));
        passEncoder.end();
        commandEncoder.copyBufferToBuffer(
          this.buffers.clusterLights.gpuBuffer,
          0,
          this.buffers.clusterLights.stagingBuffer,
          0,
          this.buffers.clusterLights.gpuBuffer.size,
        );
        commandEncoder.copyBufferToBuffer(
          this.buffers.clusterIndices.gpuBuffer,
          0,
          this.buffers.clusterIndices.stagingBuffer,
          0,
          this.buffers.clusterIndices.gpuBuffer.size,
        );
        queue.submit([commandEncoder.finish()]);
      },
      drawLightSprite: (passEncoder: GPURenderPassEncoder) => {
        passEncoder.setPipeline(this.pipelines.lightSprite);
        passEncoder.setBindGroup(0, this.bindGroups.lightSprite);
        passEncoder.draw(6, this.params.lightNum.value);
      },
      drawSphere: (passEncoder: GPURenderPassEncoder) => {
        const indicesLen = this.buffers.sphereIndices.cpuBuffer.length;
        passEncoder.setPipeline(this.pipelines.sphere);
        passEncoder.setBindGroup(0, this.bindGroups.sphere);
        passEncoder.setVertexBuffer(0, this.buffers.sphereVertex.gpuBuffer);
        passEncoder.setVertexBuffer(1, this.buffers.sphereNormal.gpuBuffer);
        passEncoder.setIndexBuffer(this.buffers.sphereIndices.gpuBuffer, 'uint32');
        passEncoder.drawIndexed(indicesLen, 8 * 8 * 8);
        // passEncoder.drawIndexed(indicesLen, 1);
      },
    };

    canvasCtx.configure({
      device,
      format: canvasFormat,
      alphaMode: 'opaque',
    });

    // requestAnimationFrame(this.render); // 首帧不展示, 这里的是为了resize之后初始化
    setTimeout(this.render, 10); // setimeout缺可以, 奇怪
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

    mat4.perspectiveZO(view.view.projection, vfov, w / h, 1, 1000);
    mat4.perspectiveZO(frustum.view.projection, vfov, w / h, near, far);
    mat4.invert(frustum.view.mapping, frustum.view.projection);

    mat4.targetTo(
      view.view.matrix,
      this.debugCameraPosition,
      [0, 0, -((far - near) * 0.5 + near)],
      // [0, 0, 0],
      this.debugCameraPosition[2] > 0 ? [0, 1, 0] : [0, 0, -1],
    );
    mat4.invert(view.view.matrix, view.view.matrix);

    view.view.zRange.set(zRange.value);
  }

  allocateViewports() {
    this.viewportSpliter.reset(Number(this.renderFinal) + Number(this.renderFrustum));

    if (this.renderFinal) this.viewport = this.viewportSpliter.getViewport();
    if (this.renderFrustum) this.debugViewport = this.viewportSpliter.getViewport();
  }

  render = async () => {
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
    this.cpuJobs.updateLightPosition();
    queue.writeBuffer(this.buffers.frustum.gpuBuffer, 0, this.buffers.frustum.cpuBuffer);
    queue.writeBuffer(this.buffers.view.gpuBuffer, 0, this.buffers.view.cpuBuffer);

    if (this.clusterBoundsNeedUpdate) {
      this.gpuJobs.computeClusterBounds();
      this.clusterBoundsNeedUpdate = false;
    }

    this.gpuJobs.computeClusterLights();

    if (this.renderFinal) {
      passEncoder.setViewport(...this.viewport, 0, 1);
      passEncoder.setScissorRect(...this.viewport);
      this.gpuJobs.drawSphere(passEncoder);
    }
    if (this.renderFrustum) {
      passEncoder.setViewport(...this.debugViewport, 0, 1);
      passEncoder.setScissorRect(...this.debugViewport);
      this.gpuJobs.drawFrustum(passEncoder);
      if (this.params.drawLightSprite.value) {
        this.gpuJobs.drawLightSprite(passEncoder);
      }
    }

    passEncoder.end();
    queue.submit([commanderEncoder.finish()]);

    if (this.printComputeResults) {
      this.printComputeResults = false;
      await queue.onSubmittedWorkDone();
      await this.buffers.clusterLights.read();
      await this.buffers.clusterBounds.read();
      await this.buffers.clusterIndices.read();
      console.log('clusterBounds', this.buffers.clusterBounds.view.bounds);
      console.log('clusterLights', this.buffers.clusterLights.view);
      console.log('clusterIndices', this.buffers.clusterIndices.view);

      // testNormalClipToView(this);
    }

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
    // TODO dispose GPU resources
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
    const id = this.splitLen - this.itemId - 1;
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
  // let x = Math.floor(n / (gridSize[1] * gridSize[2]));
  // let y = Math.floor((n % (gridSize[1] * gridSize[2])) / gridSize[2]);
  // let z = (n % (gridSize[1] * gridSize[2])) % gridSize[2];

  let z = Math.floor(n / (gridSize[1] * gridSize[0]));
  let y = Math.floor((n % (gridSize[1] * gridSize[0])) / gridSize[0]);
  let x = (n % (gridSize[1] * gridSize[2])) % gridSize[0];
  return { x, y, z };
}

const gridSize: Vec3 = [2, 2, 3];

for (let i = 0; i < gridSize[0] * gridSize[1] * gridSize[2]; i++) {
  console.log(i, idToGridId(i, gridSize));
}

{
  // BBO 有bug...
  const structDesc = {
    ambient: BBOVec3(),
    lightCount: BBO.Float32(),
    lights: BBO.NestedArrayOfBufferBackedObjects(1, {
      position: BBOVec3(),
      range: BBO.Float32(),
      color: BBOVec3(),
      intensity: BBO.Float32(),
    }),
  };
  const buffer = new ArrayBuffer(BBO.structSize(structDesc));
  const view = BBO.BufferBackedObject(buffer, structDesc);
  view.ambient.x = 1;
  view.ambient.y = 2;
  view.ambient.z = 3;
  view.lightCount = 4;
  view.lights.forEach(light => {
    light.position.x = 5;
    light.position.y = 6;
    light.position.z = 7;
    light.range = 8;
    light.color.x = 9;
    light.color.y = 10;
    light.color.z = 11;
    light.intensity = 12;
  });
  const f32 = new Float32Array(buffer);
  console.log('f32', f32);
}

function testNormalClipToView(demo: DemoClusterForward) {
  const normal_clip = vec4.fromValues(0, 0, 1, 0);
  const normal_view = vec4.create();
  vec4.transformMat4(normal_view, normal_clip, demo.buffers.frustum.view.mapping);
  // console.log({ normal_clip, normal_view });

  const mappingMat3 = mat3.create();
  const normal_clip_v3 = vec3.fromValues(0, 1, 0);
  const normal_view_v3 = vec3.create();
  mat3.fromMat4(mappingMat3, demo.buffers.frustum.view.mapping);
  // vec3.transformMat3(normal_view_v3, normal_clip_v3, mappingMat3);
  vec3.transformMat4(normal_view_v3, normal_clip_v3, demo.buffers.frustum.view.mapping);
  const normal_view_v3_90 = vec3.rotateX(
    vec3.create(),
    normal_view_v3,
    vec3.create(),
    degToRad(90),
  );
  console.log([...normal_clip_v3], [...normal_view_v3], [...normal_view_v3_90]);
}

// 重新理解四元数

function testQuat() {
  const p = vec3.fromValues(0, 0, 1);
  const q = quat.create();
  quat.setAxisAngle(q, [1, 0, 0], degToRad(90));
  // quat.normalize(q, q);
  vec3.transformQuat(p, p, q);

  console.log('p', [...p]); // 0, -1, 0

  quat.setAxisAngle(q, [1, 0, 0], degToRad(-90));
  // quat.normalize(q, q);
  vec3.transformQuat(p, p, q);

  console.log('p', [...p]); // 0, 0, 1
}

testQuat();
