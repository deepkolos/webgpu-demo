import { device } from '../context';

export interface BindGroupLayoutEntryName {
  [name: string]: GPUBindGroupLayoutEntry;
}

export type BindGroupEntryNameMap<E extends BindGroupLayoutEntryName> = {
  [K in keyof E]: BindResource;
};

/**
 * 从bind group layout 生成 bindgroup 实例
 * js内使用name关联
 */
export class BindGroupLayout<T extends BindGroupLayoutEntryName> {
  gpuLayout: GPUBindGroupLayout;
  constructor(public entryLayoutMap: T, label?: string) {
    const entries = Object.values(entryLayoutMap);
    this.gpuLayout = device.createBindGroupLayout({ label, entries });
  }

  getBindGroup(entryMap: BindGroupEntryNameMap<T>): BindGroup {
    return new BindGroup(this, entryMap);
  }
}

/**
 * 当所依赖资源有变更时自动更新对应bindgroup
 */
export class BindGroup {
  gpuBindGroup: GPUBindGroup;
  constructor(
    private bindGroupLayout: BindGroupLayout<BindGroupLayoutEntryName>,
    public entryMap: BindGroupEntryNameMap<BindGroupLayoutEntryName>,
  ) {
    this.gpuBindGroup = this.createBindGroup();
    Object.keys(entryMap).forEach(name => {
      entryMap[name].addEventListener('update', this.createBindGroup);
    });
  }

  private createBindGroup = () => {
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
export class BindResource extends EventTarget {
  static updateEvent = new Event('update');
  constructor(public gpuResource: GPUBindingResource) {
    super();
  }

  update(gpuResource: GPUBindingResource) {
    this.gpuResource = gpuResource;
    this.dispatchEvent(BindResource.updateEvent);
  }
}
