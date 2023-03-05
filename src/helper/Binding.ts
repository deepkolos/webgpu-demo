import { device } from '../context';

interface GPUBindGroupLayoutBaseEntry {
  binding: GPUIndex32;
  visibility: GPUShaderStageFlags;
}
interface GPUBindGroupLayoutBufferEntry extends GPUBindGroupLayoutBaseEntry {
  buffer: GPUBufferBindingLayout;
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
type GPUBindGroupLayoutEntry = GPUBindGroupLayoutBufferEntry | GPUBindGroupLayoutSamplerEntry | GPUBindGroupLayoutTextureEntry | GPUBindGroupLayoutStorageTextureEntry | GPUBindGroupLayoutExternalTextureEntry;

export interface BindGroupLayoutMap {
  [name: string]: GPUBindGroupLayoutEntry;
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
  constructor(public entryLayoutMap: T, label?: string) {
    const entries = Object.values(entryLayoutMap);
    this.gpuLayout = device.createBindGroupLayout({ label, entries });
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
    return device.createBindGroup({
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
