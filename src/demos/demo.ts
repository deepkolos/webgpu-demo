import type { Refs, GenOptions } from '../ui';

export interface Demo {
  name: string;
  preview: string;
  init(refs: Refs, genOptions: GenOptions): Promise<void>;
  resize(): void;
  dispose(): void;
}
