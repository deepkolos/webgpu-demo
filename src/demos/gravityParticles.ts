import { mat4 } from 'gl-matrix';
import { canvasCtx, canvasFormat, device, queue } from '../context';
import { GenOptions, Refs } from '../ui';
import { createBuffer, Demo, randomBetween } from './demo';
import preview from '../assets/screenshots/gravity-particles.png';

const DEPTH_FORMAT = 'depth24plus';

export class DemoGravityParticles implements Demo {
  name = 'GravityParticles';
  preview = preview;

  disposed = false;
  // prettier-ignore
  buffers!: { frame: { cpuBuffer: Float32Array; gpuBuffer: GPUBuffer; view: { modelView: Float32Array; projection: Float32Array; }; }; particles: { cpuBuffer: Uint8Array; gpuBuffer: GPUBuffer; view: { position: Float32Array; velocity: Float32Array; }[]; }; gravityParticles: { cpuBuffer: Uint8Array; gpuBuffer: GPUBuffer; view: { position: Float32Array; gravity: Float32Array; velocity: Float32Array; radius: Float32Array; }[]; }; };
  // prettier-ignore
  depthTexture!: GPUTexture;
  depthTextureView!: GPUTextureView;
  currFBO!: { texture: GPUTexture; view: GPUTextureView };
  swapFBO!: { texture: GPUTexture; view: GPUTextureView }[];
  swapLast!: number;
  nearstSampler!: GPUSampler;
  // prettier-ignore
  bindGroupLayouts!: { frame: GPUBindGroupLayout; compute: GPUBindGroupLayout; blendTail: GPUBindGroupLayout; quad: GPUBindGroupLayout; };
  // prettier-ignore
  bindGroups!: {
    frame: GPUBindGroup; compute: GPUBindGroup; blendTail: GPUBindGroup; // resize时赋值
    quad: GPUBindGroup;
  };
  // prettier-ignore
  pipelines!: { drawParticle: GPURenderPipeline; drawGravityParticles: GPURenderPipeline; updateParticles: GPUComputePipeline; updateGravityParticles: GPUComputePipeline; blendTail: GPURenderPipeline; drawQuad: GPURenderPipeline; };
  lastSubmitWorkDonePromise?: Promise<undefined>;
  params!: {
    particleNum: { value: number; range: Vec2; onChange: () => void };
    gravityNum: { value: number; range: Vec2; onChange: () => void };
  };

  initUI(refs: Refs, genOptions: GenOptions) {
    this.params = {
      particleNum: {
        value: 20,
        range: [1, 1000] as Vec2,
        onChange: () => {
          this.buffers.particles = this.bufferCreator.particles();
          this.bindGroups.compute = this.bindGroupsCreator.compute();
        },
      },
      gravityNum: {
        value: 2,
        range: [1, 10] as Vec2,
        onChange: () => {
          this.buffers.gravityParticles = this.bufferCreator.gravityParticles();
          this.bindGroups.compute = this.bindGroupsCreator.compute();
        },
      },
    };
    genOptions(this.params);
  }

  async init(refs: Refs, genOptions: GenOptions): Promise<void> {
    this.initUI(refs, genOptions);
    this.nearstSampler = device.createSampler({
      minFilter: 'nearest',
      magFilter: 'nearest',
    });
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
      blendTail: device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ],
      }),
      quad: device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
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
      blendTail: undefined as unknown as GPUBindGroup, // resize时赋值
      quad: undefined as unknown as GPUBindGroup, // resize时赋值
    };
    const csm = device.createShaderModule({ code: WGSL.compute, label: 'cs' });
    const vsm = device.createShaderModule({ code: WGSL.vs, label: 'vs' });
    const fsm = device.createShaderModule({ code: WGSL.fs, label: 'fs' });
    const quad = device.createShaderModule({ code: WGSL.quad, label: 'quad' });
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

      blendTail: device.createRenderPipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this.bindGroupLayouts.blendTail],
        }),
        vertex: { module: quad, entryPoint: 'vert' },
        fragment: { module: quad, entryPoint: 'fragBlend', targets: [{ format: canvasFormat }] },
        depthStencil: { format: DEPTH_FORMAT },
      }),
      drawQuad: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayouts.quad] }),
        vertex: { module: quad, entryPoint: 'vert' },
        fragment: { module: quad, entryPoint: 'frag', targets: [{ format: canvasFormat }] },
        depthStencil: { format: DEPTH_FORMAT },
      }),
    };

    canvasCtx.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

    this.disposed = false;
    this.camera.needsUpdate = true;
    setTimeout(this.render, 10);
  }

  async resize() {
    const textures = [
      this.depthTexture,
      this.currFBO?.texture,
      this.swapFBO?.[0]?.texture,
      this.swapFBO?.[1]?.texture,
    ];
    await this.lastSubmitWorkDonePromise;
    textures.forEach(i => i?.destroy());
    const w = canvasCtx.canvas.width;
    const h = canvasCtx.canvas.height;
    this.depthTexture = device.createTexture({
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      format: DEPTH_FORMAT,
      size: [w, h, 1],
      dimension: '2d',
    });
    this.depthTextureView = this.depthTexture.createView();
    this.camera.needsUpdate = true;

    const createTexure = () => {
      const texture = device.createTexture({
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        format: canvasFormat,
        size: [w, h, 1],
        dimension: '2d',
      });
      const view = texture.createView();
      return { texture, view };
    };

    this.currFBO = createTexure();
    this.swapFBO = [createTexure(), createTexure()];
    this.swapLast = 0;
  }

  async dispose() {
    this.disposed = true;

    const textures = [
      this.depthTexture,
      this.currFBO.texture,
      this.swapFBO[0].texture,
      this.swapFBO[1].texture,
    ];
    await this.lastSubmitWorkDonePromise;
    textures.forEach(i => i?.destroy());
    // TODO dispose GPU resources
  }

  get swapNext() {
    return (this.swapLast + 1) % 2;
  }

  camera = {
    fov: 45,
    near: 1,
    far: 1000,
    position: [0, 0, 100] as Vec3,
    needsUpdate: true,
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
      const length = this.params.particleNum.value;
      const stride = (4 + 4) * 4;
      const cpuBuffer = new Uint8Array(length * stride);
      const view = new Array(length).fill(0).map((v, k) => ({
        position: new Float32Array(cpuBuffer.buffer, stride * k + 0, 3),
        velocity: new Float32Array(cpuBuffer.buffer, stride * k + 4 * 4, 3),
      }));

      view.forEach(particle => {
        particle.position.set(
          [randomBetween(-10, 10), randomBetween(-10, 10), randomBetween(-10, 10)].map(i => i * 1),
        );
        particle.velocity.set(
          [randomBetween(-10, 10), randomBetween(-10, 10), randomBetween(-10, 10)].map(i => i / 12),
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
      const length = this.params.gravityNum.value;
      const stride = (4 + 4) * 4;
      const cpuBuffer = new Uint8Array(stride * length);
      const view = new Array(length).fill(0).map((v, k) => ({
        position: new Float32Array(cpuBuffer.buffer, stride * k + 0, 3),
        gravity: new Float32Array(cpuBuffer.buffer, stride * k + 3 * 4, 1),
        velocity: new Float32Array(cpuBuffer.buffer, stride * k + 4 * 4, 3),
        radius: new Float32Array(cpuBuffer.buffer, stride * k + 7 * 4, 1),
      }));

      view.forEach(particle => {
        particle.position.set(
          [randomBetween(-10, 10), randomBetween(-10, 10), randomBetween(-10, 10)].map(i => i * 2),
        );
        particle.velocity.set([
          randomBetween(-10, 10),
          randomBetween(-10, 10),
          randomBetween(-10, 10),
        ]);
        particle.gravity[0] = randomBetween(1, 10) / 600;
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
    blendTail: () =>
      device.createBindGroup({
        layout: this.bindGroupLayouts.blendTail,
        entries: [
          { binding: 0, resource: this.nearstSampler },
          { binding: 1, resource: this.swapFBO[this.swapLast].view },
          { binding: 2, resource: this.currFBO.view },
        ],
      }),
    quad: () =>
      device.createBindGroup({
        layout: this.bindGroupLayouts.quad,
        entries: [
          { binding: 0, resource: this.nearstSampler },
          { binding: 1, resource: this.swapFBO[this.swapNext].view },
        ],
      }),
  };

  gpuJobs = {
    drawTail: (commandEncoder: GPUCommandEncoder) => {
      {
        const passEncoder = commandEncoder.beginRenderPass({
          colorAttachments: [{ view: this.currFBO.view, loadOp: 'clear', storeOp: 'store' }],
          depthStencilAttachment: {
            view: this.depthTextureView,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard',
          },
        });

        passEncoder.setPipeline(this.pipelines.drawParticle);
        passEncoder.setVertexBuffer(0, this.buffers.particles.gpuBuffer);
        passEncoder.setBindGroup(0, this.bindGroups.frame);
        passEncoder.draw(6, this.params.particleNum.value);
        passEncoder.end();
      }

      // custom blend next = currFBO + last
      {
        this.bindGroups.blendTail = this.bindGroupsCreator.blendTail();
        this.bindGroups.quad = this.bindGroupsCreator.quad();
        const passEncoder = commandEncoder.beginRenderPass({
          colorAttachments: [
            {
              view: this.swapFBO[this.swapNext].view,
              loadOp: 'load',
              storeOp: 'store',
            },
          ],
          depthStencilAttachment: {
            view: this.depthTextureView,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard',
          },
        });
        passEncoder.setPipeline(this.pipelines.blendTail);
        passEncoder.setBindGroup(0, this.bindGroups.blendTail);
        passEncoder.draw(6);
        passEncoder.end();
        this.swapLast = this.swapNext;
      }
    },
    draw: (encoder: GPURenderPassEncoder) => {
      encoder.setPipeline(this.pipelines.drawQuad);
      encoder.setBindGroup(0, this.bindGroups.quad);
      encoder.draw(6);
      // encoder.setPipeline(this.pipelines.drawParticle);
      // encoder.setBindGroup(0, this.bindGroups.frame);
      // encoder.setVertexBuffer(0, this.buffers.particles.gpuBuffer);
      // encoder.draw(6, this.params.particleNum.value);

      encoder.setPipeline(this.pipelines.drawGravityParticles);
      encoder.setBindGroup(0, this.bindGroups.frame);
      encoder.setVertexBuffer(0, this.buffers.gravityParticles.gpuBuffer);
      encoder.draw(6, this.params.gravityNum.value);

      encoder.end();
    },
    simulate: (encoder: GPUCommandEncoder) => {
      const passEncoder = encoder.beginComputePass();
      passEncoder.setPipeline(this.pipelines.updateParticles);
      passEncoder.setBindGroup(0, this.bindGroups.compute);
      passEncoder.dispatchWorkgroups(Math.ceil(this.params.particleNum.value / 32));

      // passEncoder.setPipeline(this.pipelines.updateGravityParticles);
      // passEncoder.setBindGroup(0, this.bindGroups.compute);
      // passEncoder.dispatchWorkgroups(Math.ceil(3 / 32));

      passEncoder.end();
    },
  };

  render = () => {
    if (this.disposed) return;

    // 更新相机参数
    if (this.camera.needsUpdate) {
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
      this.camera.needsUpdate = false;
    }

    const commandEncoder = device.createCommandEncoder();
    // 开启了renderpass, 但未end, 是否能开启新的compute pass
    // 答案: 否
    this.gpuJobs.simulate(commandEncoder);

    this.gpuJobs.drawTail(commandEncoder);

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

    this.lastSubmitWorkDonePromise = queue.onSubmittedWorkDone();
    requestAnimationFrame(this.render);
    // setTimeout(this.render, 1000);
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

  export const quad = /* wgsl */ `
    ${vsInOutStruct}

    @group(0) @binding(0) var textureSampler: sampler;
    @group(0) @binding(1) var lastFrame: texture_2d<f32>;
    @group(0) @binding(2) var currFrame: texture_2d<f32>;

    var<private> spritePosition = array<vec2<f32>, 6>(
      vec2<f32>(-1.0, -1.0), // left bottom
      vec2<f32>(-1.0, 1.0),  // left top
      vec2<f32>(1.0, 1.0),   // right bottom
      vec2<f32>(-1.0, -1.0), // left bottom
      vec2<f32>(1.0, 1.0),   // right top
      vec2<f32>(1.0, -1.0),  // right bottom
    );

    @vertex
    fn vert(@builtin(vertex_index) vertexId: u32,
            @builtin(instance_index) instanceId: u32) -> VsOut {
      var output: VsOut;
      let localPosition = vec3<f32>(spritePosition[vertexId], 0.0);
      output.position = vec4<f32>(localPosition, 1.0);
      output.uv = localPosition.xy * 0.5 + 0.5;
      return output;
    }

    @fragment
    fn fragBlend(input: VsOut) -> @location(0) vec4<f32> {
      let currColor = textureSample(currFrame, textureSampler, input.uv);
      let lastColor = textureSample(lastFrame, textureSampler, vec2<f32>(input.uv.x, 1.0 - input.uv.y));
      // 然后需要混合 实现的效果为canvas的globalAlpha
      // 应该是lastColor 颜色是0.2, 然后当前current直接叠加即可, 
      // 那么也只是相当于修改了lastFrame的alpha然后进行正常的混合
      // 修正uv之后拖尾的采样率增加一倍, 显得非常细腻
      let blendColor = 0.75 * lastColor.rgb + currColor.rgb;
      // 能有轨迹的效果了,但是速度快的时候会导致采样不足,会导致间隙
      // 所以canvas的做法是绘制一个连线, 从上一个位置连到当前位置
      return vec4<f32>(blendColor, 1.0);
    }

    @fragment
    fn frag(input: VsOut) -> @location(0) vec4<f32> {
      return textureSample(lastFrame, textureSampler, input.uv);
    }
  `;
}
