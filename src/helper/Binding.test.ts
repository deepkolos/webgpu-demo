import { expect, test } from 'vitest';
import { VertexLayout, VertexBufferLayout, PipelineLayout, BindGroupLayout } from './Binding';

enum GPUShaderStage {
  COMPUTE = 4,
  FRAGMENT = 2,
  VERTEX = 1,
}

test('Binding VertexLayout.shaderCode', () => {
  const vertexLayout = new VertexLayout([
    new VertexBufferLayout({
      a: 'vec2_f32',
      b: 'vec3_f32',
      c: 'vec4_f32',
    }),
    new VertexBufferLayout({
      f: 'f32',
      u: 'u32',
    }),
  ]);
  // console.log(vertexLayout.shaderCode);
  expect(vertexLayout.shaderCode).toBe(`struct VsIn {
  @location(0) a: vec2<f32>,
  @location(1) b: vec3<f32>,
  @location(2) c: vec4<f32>,
  @location(3) f: f32,
  @location(4) u: u32,
};`);
});

test('Binding VertexLayout.gpuBufferLayout', () => {
  const vertexLayout = new VertexLayout([
    new VertexBufferLayout({
      a: 'vec2_f32',
      b: 'vec3_f32',
      c: 'vec4_f32',
    }),
    new VertexBufferLayout({
      f: 'f32',
      u: 'u32',
    }),
  ]);
  // console.log(JSON.stringify(vertexLayout.gpuBufferLayout, null, 2));
  expect(vertexLayout.gpuBufferLayout).toStrictEqual([
    {
      arrayStride: 36,
      stepMode: undefined,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' },
        { shaderLocation: 1, offset: 8, format: 'float32x3' },
        { shaderLocation: 2, offset: 20, format: 'float32x4' },
      ],
    },
    {
      arrayStride: 8,
      stepMode: undefined,
      attributes: [
        { shaderLocation: 3, offset: 0, format: 'float32' },
        { shaderLocation: 4, offset: 4, format: 'uint32' },
      ],
    },
  ]);
});

test('Binding PipelineLayout.shaderCode', () => {
  const scene = new BindGroupLayout({
    camera: {
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        struct: {
          projection: 'mat4x4_f32',
          modelView: 'mat4x4_f32',
          near: 'f32',
          far: 'f32',
        },
      },
    },
    globalLights: {
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
      buffer: {
        type: 'read-only-storage',
        struct: {
          ambient: 'vec3_f32',
          lightCount: 'u32',
          lights: [
            {
              position: 'vec3_f32',
              range: 'f32',
              color: 'vec3_f32',
              intensity: 'f32',
            },
            1000,
          ],
        },
      },
    },
    clusterLights: {
      visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
      buffer: {
        type: 'storage',
        struct: {
          offset: 'u32',
          lights: [{ offset: 'u32', count: 'u32' }, 100],
        },
      },
    },
    clusterIndices: {
      visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
      buffer: {
        type: 'storage',
        struct: {
          indices: [{ x: 'u32' }, 100 * 100],
        },
      },
    },
  });
  const model = new BindGroupLayout({
    model: {
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {
        struct: {
          worldMatrix: 'mat4x4_f32',
        },
      },
    },
  });
  const material = new BindGroupLayout({
    material: {
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {
        struct: {
          color: 'vec3_f32',
        },
      },
    },
  });
  const pipelineLayout = new PipelineLayout([scene, model, material]);
  console.log(pipelineLayout.shaderCode);
  expect(pipelineLayout.shaderCode).toBe(/* wgsl */ `

struct S_camera {
  projection: mat4x4<f32>,
  modelView: mat4x4<f32>,
  near: f32,
  far: f32,
};
struct S_globalLights_lights {
  position: vec3<f32>,
  range: f32,
  color: vec3<f32>,
  intensity: f32,
};
struct S_globalLights {
  ambient: vec3<f32>,
  lightCount: u32,
  lights: array<S_globalLights_lights, 1000>,
};
struct S_clusterLights_lights {
  offset: u32,
  count: u32,
};
struct S_clusterLights {
  offset: u32,
  lights: array<S_clusterLights_lights, 100>,
};
struct S_clusterIndices_indices {
  x: u32,
};
struct S_clusterIndices {
  indices: array<S_clusterIndices_indices, 10000>,
};

struct S_model {
  worldMatrix: mat4x4<f32>,
};

struct S_material {
  color: vec3<f32>,
};
@group(0) @binding(0) var<uniform> camera: S_camera;
@group(0) @binding(1) var<storage, read> globalLights: S_globalLights;
@group(0) @binding(2) var<storage, read_write> clusterLights: S_clusterLights;
@group(0) @binding(3) var<storage, read_write> clusterIndices: S_clusterIndices;
@group(1) @binding(0) var<uniform> model: S_model;
@group(2) @binding(0) var<uniform> material: S_material;`);
});
