import { device } from '../context';
import { wgsl } from './StructBuffer';

interface GPUBindGroupLayoutBaseEntry {
  binding?: GPUIndex32;
  visibility: GPUShaderStageFlags;
}
interface GPUBindGroupLayoutBufferEntry extends GPUBindGroupLayoutBaseEntry {
  buffer: GPUBufferBindingLayout & { struct: wgsl.Struct };
}
interface GPUBindGroupLayoutSamplerEntry extends GPUBindGroupLayoutBaseEntry {
  sampler: GPUSamplerBindingLayout;
}
interface GPUBindGroupLayoutTextureEntry extends GPUBindGroupLayoutBaseEntry {
  texture: GPUTextureBindingLayout;
}
interface GPUBindGroupLayoutStorageTextureEntry extends GPUBindGroupLayoutBaseEntry {
  storageTexture: GPUStorageTextureBindingLayout;
}
interface GPUBindGroupLayoutExternalTextureEntry extends GPUBindGroupLayoutBaseEntry {
  externalTexture: GPUExternalTextureBindingLayout;
}
// prettier-ignore
type BindGroupLayoutEntry = GPUBindGroupLayoutBufferEntry | GPUBindGroupLayoutSamplerEntry | GPUBindGroupLayoutTextureEntry | GPUBindGroupLayoutStorageTextureEntry | GPUBindGroupLayoutExternalTextureEntry;
type GPUBindGroupLayoutEntry<T = BindGroupLayoutEntry> = {
  [K in keyof T]-?: T[K];
};
type GPUBindGroupLayoutMap = {
  [name: string]: GPUBindGroupLayoutEntry;
};
export interface BindGroupLayoutMap {
  [name: string]: BindGroupLayoutEntry;
}

export type BindGroupMap<E extends BindGroupLayoutMap> = {
  [K in keyof E]: E[K] extends GPUBindGroupLayoutBufferEntry
    ? GPUBufferBinding
    : E[K] extends GPUBindGroupLayoutSamplerEntry
    ? GPUSampler
    : E[K] extends GPUBindGroupLayoutTextureEntry
    ? GPUTextureView
    : E[K] extends GPUBindGroupLayoutStorageTextureEntry
    ? GPUTextureView
    : E[K] extends GPUBindGroupLayoutExternalTextureEntry
    ? GPUExternalTexture
    : never;
};

export type BindGroupBindResourceMap<E extends BindGroupMap<T>, T extends BindGroupLayoutMap> = {
  [K in keyof T]: BindResource<E[K]>;
};

/**
 * 从bind group layout 生成 bindgroup 实例
 * js内使用name关联
 */
export class BindGroupLayout<T extends BindGroupLayoutMap> {
  gpuLayout: GPUBindGroupLayout;
  entryLayoutMap: GPUBindGroupLayoutMap;
  constructor(entryLayoutMap: T, label?: string) {
    const entries = Object.values(entryLayoutMap).map((i, k) => {
      i.binding ??= k;
      return i;
    }) as GPUBindGroupLayoutEntry[];
    this.entryLayoutMap = entryLayoutMap as GPUBindGroupLayoutMap;
    this.gpuLayout = device?.createBindGroupLayout({ label, entries });
  }

  getBindGroup(entryMap: BindGroupMap<T>): BindGroup {
    return new BindGroup(this, entryMap);
  }
}

/**
 * 当所依赖资源有变更时自动更新对应bindgroup
 */
export class BindGroup {
  gpuBindGroup: GPUBindGroup;
  entryMap: BindGroupBindResourceMap<BindGroupMap<BindGroupLayoutMap>, BindGroupLayoutMap>;

  constructor(
    private bindGroupLayout: BindGroupLayout<BindGroupLayoutMap>,
    entryMap: BindGroupMap<BindGroupLayoutMap>,
  ) {
    this.entryMap = Object.keys(entryMap).map(
      name => new BindResource(entryMap[name], this),
    ) as any;
    this.gpuBindGroup = this.updateBindGroup();
  }

  updateBindGroup = () => {
    const entries: Iterable<GPUBindGroupEntry> = Object.entries(
      this.bindGroupLayout.entryLayoutMap,
    ).map(([name, layout]) => ({
      binding: layout.binding,
      resource: this.entryMap[name].gpuResource,
    }));
    return device?.createBindGroup({
      layout: this.bindGroupLayout.gpuLayout,
      entries,
    });
  };
}

/**
 * 资源更新通知依赖更新
 */
class BindResource<T extends GPUBindingResource> {
  constructor(public gpuResource: T, public bindGroup: BindGroup) {}

  update(gpuResource: T) {
    this.gpuResource = gpuResource;
    this.bindGroup.updateBindGroup();
  }
}

export class PipelineLayout<T extends BindGroupLayout<any>[]> {
  gpuPipelineLayout: GPUPipelineLayout;
  shaderCode: string;
  constructor(public bindGroupLayouts: T) {
    this.gpuPipelineLayout = device?.createPipelineLayout({
      bindGroupLayouts: bindGroupLayouts.map(i => i.gpuLayout),
    });
    this.shaderCode = this.getShaderCode();
  }

  private getShaderCode(): string {
    let structStr = '';
    const bindGroupStr = this.bindGroupLayouts
      .map((layout, i) =>
        Object.entries(layout.entryLayoutMap)
          .map(([key, value]) => {
            let typeStr: string;
            let varTypeStr = '';
            if ('buffer' in value) {
              typeStr = 'S_' + key;
              structStr += '\n' + wgsl.stringifyStruct(typeStr, value.buffer.struct);
              const bufferType = value.buffer.type ?? 'uniform';
              if (bufferType === 'uniform') {
                varTypeStr = '<uniform>';
              } else if (bufferType === 'storage') {
                varTypeStr = '<storage, read_write>';
              } else {
                varTypeStr = '<storage, read>';
              }
            } else if ('sampler' in value) {
              typeStr = 'sampler';
            } else if ('texture' in value) {
              typeStr = 'texture_2d<f32>';
            } else if ('storageTexture' in value) {
              typeStr = 'texture_2d<f32>';
            } else {
              typeStr = 'texture_2d<f32>';
            }
            return `@group(${i}) @binding(${value.binding}) var${varTypeStr} ${key}: ${typeStr};`;
          })
          .join('\n'),
      )
      .join('\n');
    return structStr + '\n' + bindGroupStr;
  }
}

export class VertexBufferLayout<T extends wgsl.PlainStruct> {
  structSize: number;
  structInfo: wgsl.PlainStructInfo<T>;
  stepMode: GPUVertexStepMode | undefined;
  constructor(public plainStruct: T, stepMode?: GPUVertexStepMode, ignoreAlign = true) {
    // vertex buffer往往数量多, 更新更合适是使用offset直接更新
    this.structSize = wgsl.structSize(plainStruct, ignoreAlign);
    this.structInfo = wgsl.structInfo(plainStruct, ignoreAlign);
    this.stepMode = stepMode;
  }
}

export class VertexLayout<T extends VertexBufferLayout<wgsl.PlainStruct>[]> {
  gpuBufferLayout: GPUVertexBufferLayout[];
  shaderCode: string;
  constructor(public bufferLayouts: T) {
    this.gpuBufferLayout = this.getBufferLayout();
    this.shaderCode = this.getShaderCode();
  }

  private getBufferLayout() {
    let id = 0;
    return this.bufferLayouts.map(layout => ({
      arrayStride: layout.structSize,
      stepMode: layout.stepMode,
      attributes: Object.keys(layout.plainStruct).map(key => ({
        shaderLocation: id++,
        offset: layout.structInfo[key].offset,
        format: wgsl.PrimitiveToGPUVertexFormat[layout.plainStruct[key]],
      })),
    }));
  }

  private getShaderCode() {
    let id = 0;
    let code = `struct VsIn {
${this.bufferLayouts
  .map(layout => {
    return Object.keys(layout.plainStruct)
      .map(name => {
        const value = layout.plainStruct[name];
        return `  @location(${id++}) ${name}: ${wgsl.stringifyPrimitive(value)},`;
      })
      .join('\n');
  })
  .join('\n')}
};`;
    return code;
  }
}
