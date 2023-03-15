import { mat4 } from 'gl-matrix';
import { canvasCtx, canvasFormat, device, queue } from '../context';
import { BindGroupLayout, PipelineLayout, VertexBufferLayout, VertexLayout, wgsl } from '../helper';
import { GPUShader } from '../helper/Enum';
import { GenOptions, Refs } from '../ui';
import { createBuffer, createTexture, Demo } from './demo';

// prettier-ignore
const cube = {
  position: new Float32Array([1, 1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, -1, 1, 1, -1, 1, -1, -1, -1, -1, -1, -1, 1, -1, 1, 1, 1, 1, 1, 1, 1, -1, -1, 1, -1, -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1, -1, 1, 1, -1, 1, -1, -1, -1, -1, -1]),
  normal:   new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]),
  texcoord: new Float32Array([1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1]),
  indices:  new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23]),
}

const uboStruct = {
  world: 'mat4x4_f32',
  projection: 'mat4x4_f32',
  viewInverse: 'mat4x4_f32',
  worldInverseTranspose: 'mat4x4_f32',
  lightWorldPos: 'vec3_f32',
  lightColor: 'vec4_f32',
  ambient: 'vec4_f32',
  specular: 'vec4_f32',
  shininess: 'f32',
  specularFactor: 'f32',
} satisfies wgsl.Struct;

export class DemoCube implements Demo {
  name = 'Cube';
  preview = '';
  render!: () => void;
  depthTexture!: GPUTexture;
  depthTextureView!: GPUTextureView;
  async init(refs: Refs, genOptions: GenOptions): Promise<void> {
    const bindGroupLayout = new BindGroupLayout({
      ubo: { visibility: GPUShader.VS | GPUShader.FS, buffer: { struct: uboStruct } },
      diffuse: { visibility: GPUShader.FS, texture: {} },
      diffuseSampler: { visibility: GPUShader.FS, sampler: {} },
    });
    const pipelineLayout = new PipelineLayout([bindGroupLayout]);
    const vertexLayout = new VertexLayout({
      positionBuffer: new VertexBufferLayout({ position: 'vec3_f32' }),
      uvBuffer: new VertexBufferLayout({ uv: 'vec2_f32' }),
      normalBuffer: new VertexBufferLayout({ normal: 'vec3_f32' }),
    });

    const uboStructBuffer = new wgsl.StructBuffer(uboStruct);
    const buffers = {
      ubo: createBuffer(uboStructBuffer.buffer, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      position: createBuffer(cube.position, GPUBufferUsage.VERTEX, true),
      uv: createBuffer(cube.texcoord, GPUBufferUsage.VERTEX, true),
      normal: createBuffer(cube.normal, GPUBufferUsage.VERTEX, true),
      indices: createBuffer(cube.indices, GPUBufferUsage.INDEX, true),
    };

    const texture = await createTexture({
      data: [255, 255, 255, 255, 192, 192, 192, 255, 192, 192, 192, 255, 255, 255, 255, 255],
      width: 2,
      height: 2,
      // 这里需要RENDER_ATTACHMENT是否说明copyExternalImageToTexture内部实现里有一次drawcall??
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
    const nearstSampler = device.createSampler({});

    const bindGroup = bindGroupLayout.getBindGroup({
      ubo: { buffer: buffers.ubo },
      diffuse: texture.createView(),
      diffuseSampler: nearstSampler,
    });

    const shaderCode = `
${vertexLayout.shaderCode}
${pipelineLayout.shaderCode}
${shader}`;
    console.log(shaderCode);
    const shaderModule = device.createShaderModule({ code: shaderCode });

    const pipeline = device.createRenderPipeline({
      layout: pipelineLayout.gpuPipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vertMain',
        buffers: vertexLayout.gpuBufferLayout,
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragMain',
        targets: [{ format: canvasFormat }],
      },
      primitive: {
        frontFace: 'ccw',
        cullMode: 'back',
      },
      depthStencil: {
        format: 'depth24plus',
        depthCompare: 'less',
        depthWriteEnabled: false,
      },
    });

    canvasCtx.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

    const uboView = uboStructBuffer.view;
    uboView.lightWorldPos.set([1, 8, -10]);
    uboView.lightColor.set([1, 0.8, 0.8, 1]);
    uboView.ambient.set([0, 0, 0, 1]);
    uboView.specular.set([1, 1, 1, 1]);
    uboView.shininess = 50;
    uboView.specularFactor = 1;

    let time = 0;
    this.render = () => {
      const aspect = canvasCtx.canvas.width / canvasCtx.canvas.height;
      time += 0.016;
      mat4.fromYRotation(uboView.world, time);

      mat4.targetTo(uboView.viewInverse, [1, 4, -6], [0, 0, 0], [0, 1, 0]);
      mat4.invert(uboView.viewInverse, uboView.viewInverse);

      mat4.perspectiveZO(uboView.projection, 30, aspect, 0.5, 10);

      mat4.invert(uboView.worldInverseTranspose, uboView.world);
      mat4.transpose(uboView.worldInverseTranspose, uboView.worldInverseTranspose);

      queue.writeBuffer(buffers.ubo, 0, uboStructBuffer.buffer);
      const commandEncoder = device.createCommandEncoder();
      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [
          { view: canvasCtx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
        ],
        depthStencilAttachment: {
          view: this.depthTextureView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
        },
      });
      passEncoder.setPipeline(pipeline);
      passEncoder.setBindGroup(0, bindGroup.gpuBindGroup);
      passEncoder.setVertexBuffer(0, buffers.position);
      passEncoder.setVertexBuffer(1, buffers.uv);
      passEncoder.setVertexBuffer(2, buffers.normal);
      passEncoder.setIndexBuffer(buffers.indices, 'uint16');
      passEncoder.drawIndexed(cube.indices.length);
      passEncoder.end();
      queue.submit([commandEncoder.finish()]);

      requestAnimationFrame(this.render);
    };

    setTimeout(this.render, 10);
  }

  resize(): void {
    this.depthTexture = device.createTexture({
      size: [canvasCtx.canvas.width, canvasCtx.canvas.height, 1],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthTextureView = this.depthTexture.createView();
  }
  dispose(): void {}
}

const shader = /* wgsl */ `
alias v4 = vec4<f32>; alias v3 = vec3<f32>; alias v2 = vec2<f32>;

struct VsOut {
  @builtin(position) position: v4,
  @location(0) uv: v2,
  @location(1) normal: v3,
  @location(2) surfaceToLight: v3,
  @location(3) surfaceToView: v3,
};

@vertex
fn vertMain(input: VsIn) -> VsOut {
  var output: VsOut;
  let positionWorld = ubo.world * v4(input.position, 1.0);
  output.position = ubo.projection * ubo.viewInverse * positionWorld;
  output.uv = input.uv;
  output.normal = (ubo.worldInverseTranspose * v4(input.normal, 0.0)).xyz;
  output.surfaceToLight = ubo.lightWorldPos - positionWorld.xyz;
  output.surfaceToView = ubo.viewInverse[3].xyz - positionWorld.xyz;
  return output;
}

@fragment
fn fragMain(input: VsOut) -> @location(0) vec4<f32> {
  let diffuseColor = textureSample(diffuse, diffuseSampler, input.uv);
  let normal = normalize(input.normal);
  let surfaceToLight = normalize(input.surfaceToLight);
  let surfaceToView = normalize(input.surfaceToView);
  let halfVector = normalize(surfaceToLight + surfaceToView);
  let diffuseFactor = max(dot(normal, surfaceToLight), 0.0);
  let specularFactor = pow(max(dot(normal, halfVector), 0.0), ubo.shininess) * ubo.specularFactor;

  return v4(
    (ubo.lightColor * (
        diffuseColor * diffuseFactor 
      + diffuseColor * ubo.ambient
      + ubo.specular * specularFactor
    )).rgb,
    diffuseColor.a
  );
}
`;
