import { mat4 } from 'gl-matrix';
import { canvasCtx, canvasFormat, device, queue } from '../context';
import { GenOptions, Refs } from '../ui';
import { createBuffer, Demo, randomBetween } from './demo';

const DEPTH_FORMAT = 'depth24plus';

export class DemoGravityParticles implements Demo {
  name = 'GravityParticles';
  preview = '';

  disposed = false;
  // prettier-ignore
  buffers!: { frame: { cpuBuffer: Float32Array; gpuBuffer: GPUBuffer; view: { modelView: Float32Array; projection: Float32Array; }; }; particles: { cpuBuffer: Uint8Array; gpuBuffer: GPUBuffer; view: { position: Float32Array; velocity: Float32Array; }[]; }; gravityParticles: { cpuBuffer: Uint8Array; gpuBuffer: GPUBuffer; view: { position: Float32Array; gravity: Float32Array; velocity: Float32Array; radius: Float32Array; }[]; }; };
  // prettier-ignore
  bindGroupLayouts!: { frame: GPUBindGroupLayout; compute: GPUBindGroupLayout; };
  // prettier-ignore
  bindGroups!: { frame: GPUBindGroup; compute: GPUBindGroup; };
  pipelines!: {
    drawParticle: GPURenderPipeline;
    drawGravityParticles: GPURenderPipeline;
    updateParticles: GPUComputePipeline;
    updateGravityParticles: GPUComputePipeline;
  };
  depthTexture!: GPUTexture;
  depthTextureView!: GPUTextureView;

  async init(refs: Refs, genOptions: GenOptions): Promise<void> {
    this.bindGroupLayouts = {
      frame: device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
      }),
      compute: device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ],
      }),
    };
    this.buffers = {
      frame: this.bufferCreator.frame(),
      particles: this.bufferCreator.particles(),
      gravityParticles: this.bufferCreator.gravityParticles(),
    };
    this.bindGroups = {
      frame: this.bindGroupsCreator.frame(),
      compute: this.bindGroupsCreator.compute(),
    };
    const csm = device.createShaderModule({ code: WGSL.compute, label: 'cs' });
    const vsm = device.createShaderModule({ code: WGSL.vs, label: 'vs' });
    const fsm = device.createShaderModule({ code: WGSL.fs, label: 'fs' });
    this.pipelines = {
      drawParticle: device.createRenderPipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this.bindGroupLayouts.frame],
        }),
        vertex: {
          module: vsm,
          entryPoint: 'main',
          buffers: [
            {
              arrayStride: 8 * 4,
              stepMode: 'instance',
              attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
            },
          ],
        },
        fragment: {
          module: fsm,
          entryPoint: 'fsParticle',
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
        depthStencil: {
          format: DEPTH_FORMAT,
        },
      }),
      drawGravityParticles: device.createRenderPipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this.bindGroupLayouts.frame],
        }),
        vertex: {
          module: vsm,
          entryPoint: 'main',
          buffers: [
            {
              arrayStride: 8 * 4,
              stepMode: 'instance',
              attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
            },
          ],
        },
        fragment: {
          module: fsm,
          entryPoint: 'fsGravityParticle',
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
        depthStencil: {
          format: DEPTH_FORMAT,
        },
      }),

      updateParticles: device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayouts.compute] }),
        compute: {
          module: csm,
          entryPoint: 'updateParticles',
        },
      }),
      updateGravityParticles: device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayouts.compute] }),
        compute: {
          module: csm,
          entryPoint: 'updateGravityParticles',
        },
      }),
    };

    canvasCtx.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

    this.disposed = false;
    setTimeout(this.render, 10);
  }

  resize(): void {
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

  camera = {
    fov: 45,
    near: 1,
    far: 1000,
    position: [0, 0, 100] as Vec3,
  };

  bufferCreator = {
    frame: () => {
      const cpuBuffer = new Float32Array(16 + 16);
      const view = {
        modelView: new Float32Array(cpuBuffer.buffer, 0, 16),
        projection: new Float32Array(cpuBuffer.buffer, 16 * 4, 16),
      };
      const gpuBuffer = createBuffer(
        cpuBuffer,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        false,
      );
      return { cpuBuffer, gpuBuffer, view };
    },
    particles: () => {
      const length = 1000;
      const stride = (4 + 4) * 4;
      const cpuBuffer = new Uint8Array(length * stride);
      const view = new Array(length).fill(0).map((v, k) => ({
        position: new Float32Array(cpuBuffer.buffer, stride * k + 0, 3),
        velocity: new Float32Array(cpuBuffer.buffer, stride * k + 4 * 4, 3),
      }));

      view.forEach(particle => {
        particle.position.set([
          randomBetween(-10, 10),
          randomBetween(-10, 10),
          randomBetween(-10, 10),
        ]);
        particle.velocity.set(
          [randomBetween(-10, 10), randomBetween(-10, 10), randomBetween(-10, 10)].map(i => i / 6),
        );
      });
      const gpuBuffer = createBuffer(
        cpuBuffer,
        GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
        true,
      );
      return { cpuBuffer, gpuBuffer, view };
    },
    gravityParticles: () => {
      // vertex buffer 有最小值限制, 最小值172
      // 但是为了利用runtime size, 也导致不好增加额外的padding
      // 增加padding后runtimesize返回就不对了...真的难搞...
      const length = 6;
      const stride = (4 + 4) * 4;
      const cpuBuffer = new Uint8Array(stride * length);
      const view = new Array(length).fill(0).map((v, k) => ({
        position: new Float32Array(cpuBuffer.buffer, stride * k + 0, 3),
        gravity: new Float32Array(cpuBuffer.buffer, stride * k + 3 * 4, 1),
        velocity: new Float32Array(cpuBuffer.buffer, stride * k + 4 * 4, 3),
        radius: new Float32Array(cpuBuffer.buffer, stride * k + 7 * 4, 1),
      }));

      view.forEach(particle => {
        particle.position.set([
          randomBetween(-10, 10),
          randomBetween(-10, 10),
          randomBetween(-10, 10),
        ]);
        particle.velocity.set([
          randomBetween(-10, 10),
          randomBetween(-10, 10),
          randomBetween(-10, 10),
        ]);
        particle.gravity[0] = randomBetween(1, 10) / 300;
        particle.radius[0] = randomBetween(1, 10) / 300;
      });
      const gpuBuffer = createBuffer(
        cpuBuffer,
        GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
        true,
      );
      return { cpuBuffer, gpuBuffer, view };
    },
  };
  bindGroupsCreator = {
    frame: () =>
      device.createBindGroup({
        layout: this.bindGroupLayouts.frame,
        entries: [{ binding: 0, resource: { buffer: this.buffers.frame.gpuBuffer } }],
      }),
    compute: () =>
      device.createBindGroup({
        layout: this.bindGroupLayouts.compute,
        entries: [
          { binding: 0, resource: { buffer: this.buffers.particles.gpuBuffer } },
          { binding: 1, resource: { buffer: this.buffers.gravityParticles.gpuBuffer } },
        ],
      }),
  };

  gpuJobs = {
    draw: (encoder: GPURenderPassEncoder) => {
      encoder.setPipeline(this.pipelines.drawParticle);
      encoder.setBindGroup(0, this.bindGroups.frame);
      encoder.setVertexBuffer(0, this.buffers.particles.gpuBuffer);
      encoder.draw(6, 20);

      encoder.setPipeline(this.pipelines.drawGravityParticles);
      encoder.setBindGroup(0, this.bindGroups.frame);
      encoder.setVertexBuffer(0, this.buffers.gravityParticles.gpuBuffer);
      encoder.draw(6, 6);

      encoder.end();
    },
    simulate: (encoder: GPUCommandEncoder) => {
      const passEncoder = encoder.beginComputePass();
      passEncoder.setPipeline(this.pipelines.updateParticles);
      passEncoder.setBindGroup(0, this.bindGroups.compute);
      passEncoder.dispatchWorkgroups(Math.ceil(100 / 32));

      // passEncoder.setPipeline(this.pipelines.updateGravityParticles);
      // passEncoder.setBindGroup(0, this.bindGroups.compute);
      // passEncoder.dispatchWorkgroups(Math.ceil(3 / 32));

      passEncoder.end();
    },
  };

  render = () => {
    if (this.disposed) return;

    // 更新相机参数
    const w = canvasCtx.canvas.width;
    const h = canvasCtx.canvas.height;
    mat4.perspectiveZO(
      this.buffers.frame.view.projection,
      this.camera.fov,
      w / h,
      this.camera.near,
      this.camera.far,
    );
    mat4.fromTranslation(this.buffers.frame.view.modelView, this.camera.position);
    mat4.invert(this.buffers.frame.view.modelView, this.buffers.frame.view.modelView);
    queue.writeBuffer(this.buffers.frame.gpuBuffer, 0, this.buffers.frame.cpuBuffer);

    const commandEncoder = device.createCommandEncoder();
    // 开启了renderpass, 但未end, 是否能开启新的compute pass
    // 答案: 否
    this.gpuJobs.simulate(commandEncoder);

    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: canvasCtx.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthTextureView,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    this.gpuJobs.draw(passEncoder);

    queue.submit([commandEncoder.finish()]);

    requestAnimationFrame(this.render);
  };
}

namespace WGSL {
  export const structDef = /* wgsl */ `
    struct Particle {
      position: vec3<f32>,
      velocity: vec3<f32>,
    };

    struct GravityParticle {
      position: vec3<f32>,
      gravity: f32,
      velocity: vec3<f32>,
      radius: f32,
    };
    `;

  export const frameUniforms = /* wgsl */ `
    struct FrameUnifroms {
      modelView: mat4x4<f32>,
      projection: mat4x4<f32>,
    };
  `;

  export const vsInOutStruct = /* wgsl */ `
    struct VsIn {
      @builtin(vertex_index) vertexId: u32,
      @builtin(instance_index) instanceId: u32,
      @location(0) translate: vec3<f32>,
    };
    struct VsOut {
      @builtin(position) position: vec4<f32>,
      @location(0) uv: vec2<f32>,
    };
  `;

  export const compute = /* wgsl */ `
    ${structDef}

    @group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
    @group(0) @binding(1) var<storage, read_write> gravityParticles: array<GravityParticle>;

    @compute @workgroup_size(32)
    fn updateGravityParticles(@builtin(global_invocation_id) g_invoc_id: vec3<u32>) {
      // 每个invocation对应一个gravityParticle
      let i = g_invoc_id.x;
      let max_index = arrayLength(&gravityParticles) - 1u;

      if (i <= max_index) {
        // gravityParticle 之间的影响
        for (var gi = 0u; gi <= max_index; gi = gi + 1u) {
          if (gi == i) { continue; }

          let dir = normalize(gravityParticles[gi].position - gravityParticles[i].position);
          gravityParticles[i].velocity += dir * gravityParticles[gi].gravity;
        }

        gravityParticles[i].position += gravityParticles[i].velocity;
      }
    }

    @compute @workgroup_size(32)
    fn updateParticles(@builtin(global_invocation_id) g_invoc_id: vec3<u32>) {
      // 每个invocation对应一个particle
      let i = g_invoc_id.x;
      let max_index = arrayLength(&particles) - 1u;
      let gravityLen = arrayLength(&gravityParticles);

      if (i <= max_index) {
        // 更新每个粒子受gravityParticle影响的速度
        for (var gi = 0u; gi < gravityLen; gi = gi + 1u) {
          let dir = normalize(gravityParticles[gi].position - particles[i].position);
          particles[i].velocity += dir * gravityParticles[gi].gravity;
        }

        // 更新本粒子位置
        particles[i].position += particles[i].velocity;
      }
    }
  `;

  export const vs = /* wgsl */ `
    ${vsInOutStruct}
    ${frameUniforms}
    @group(0) @binding(0) var<uniform> frame: FrameUnifroms;

    var<private> spritePosition = array<vec2<f32>, 6>(
      vec2<f32>(-1.0, -1.0), // left bottom
      vec2<f32>(-1.0, 1.0),  // left top
      vec2<f32>(1.0, 1.0),   // right bottom
      vec2<f32>(-1.0, -1.0), // left bottom
      vec2<f32>(1.0, 1.0),   // right top
      vec2<f32>(1.0, -1.0),  // right bottom
    );

    @vertex
    fn main(input: VsIn) -> VsOut {
      var output: VsOut;
      let localPosition = vec3<f32>(spritePosition[input.vertexId], 0.0);
      let worldPosition = localPosition + input.translate;  
      output.position = frame.projection * frame.modelView * vec4<f32>(worldPosition, 1.0);
      output.uv = localPosition.xy * 0.5 + 0.5;
      return output;
    }
  `;

  export const fs = /* wgsl */ `
    ${vsInOutStruct}

    @fragment
    fn fsParticle(input: VsOut) -> @location(0) vec4<f32> {
      let dist = distance(input.uv, vec2<f32>(0.5, 0.5));
      let alpha = 1.0 - smoothstep(0.45, 0.5, dist);
      return vec4<f32>(1.0, 1.0, 1.0, alpha);
    }

    @fragment
    fn fsGravityParticle(input: VsOut) -> @location(0) vec4<f32> {
      let dist = distance(input.uv, vec2<f32>(0.5, 0.5));
      let alpha = 1.0 - smoothstep(0.45, 0.5, dist);
      return vec4<f32>(1.0, 0.0, 1.0, alpha);
    }
  `;
}
