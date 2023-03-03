// https://github.com/microsoft/TypeScript/issues/53062
// 不能嵌套这个, 只是单层的
type NoEmptyRecord<T> = T & (keyof T extends never ? 'No empty object' : {});

export namespace wgsl {
  enum PrimitiveDataViewGet {
    f32 = 'getFloat32',
    u32 = 'getUint32',
    i32 = 'getInt32',
  }
  enum PrimitiveDataViewSet {
    f32 = 'setFloat32',
    u32 = 'setUint32',
    i32 = 'setInt32',
  }
  const PrimitiveTypedArrayMap: {
    [k in PrimitiveNumber]:
      | Float64ArrayConstructor
      | Float32ArrayConstructor
      | Uint32ArrayConstructor
      | Uint16ArrayConstructor
      | Int16ArrayConstructor
      | Uint8ArrayConstructor
      | Int8ArrayConstructor
      | Int32ArrayConstructor;
  } = Object.freeze({
    f32: Float32Array,
    u32: Uint32Array,
    i32: Int32Array,
  });
  const PrimitiveTypedArrayLenMap: { [k: string]: number } = Object.freeze({
    vec2: 2,
    vec3: 3,
    vec4: 4, // mat3x3 layout:  1 1 1 0
    mat3x3: 12, // = 48 / 4     1 1 1 0
    mat4x4: 16, //              1 1 1 0
  });
  const PrimitiveAlignSize: { [K in Primitive]: { size: number; align: number } } = Object.freeze({
    f32: { size: 4, align: 4 },
    u32: { size: 4, align: 4 },
    i32: { size: 4, align: 4 },
    vec2_f32: { size: 8, align: 8 },
    vec3_f32: { size: 12, align: 16 },
    vec4_f32: { size: 16, align: 16 },
    mat4x4_f32: { size: 64, align: 16 },
    mat3x3_f32: { size: 48, align: 16 },
  });
  export type PrimitiveNumber = 'f32' | 'u32' | 'i32';
  export type PrimitiveTypedArray =
    | 'vec2_f32'
    | 'vec3_f32'
    | 'vec4_f32'
    | 'mat4x4_f32'
    | 'mat3x3_f32';
  export type Primitive = PrimitiveNumber | PrimitiveTypedArray;
  export type PrimitiveView = {
    f32: number;
    u32: number;
    i32: number;
    vec2_f32: Float32Array;
    vec3_f32: Float32Array;
    vec4_f32: Float32Array;
    mat4x4_f32: Float32Array;
    mat3x3_f32: Float32Array;
  };
  export type Array = [struct: Struct, length: number, runtimeSized?: boolean];
  export interface Struct {
    [k: string]: Primitive | Array | Struct;
  }
  export type StructView<T extends Struct> = {
    [K in keyof T]: T[K] extends Struct
      ? StructView<T[K]>
      : T[K] extends Array
      ? StructView<T[K][0]>[]
      : T[K] extends Primitive
      ? PrimitiveView[T[K]]
      : never;
  };

  export function getPrimitiveString(primitive: Primitive) {
    if (primitive.indexOf('_') > -1) {
      return primitive.replace('_', '<') + '>';
    }
    return primitive;
  }

  export function getSubStructString(substruct: Struct, name: string) {
    return `
struct ${name} {
  ${Object.entries(substruct)
    .map(([key, value]) => {
      return `    ${key}: ${value},`;
    })
    .join('\n')}
};`;
  }

  export function getStructString<T extends Struct>(name: string, struct: T, params: any) {
    let output = '';
    let structStr = `struct ${name} {`;
    for (let [key, value] of Object.entries(struct)) {
      const substructName = name + '_' + key;
      if (Array.isArray(value)) {
        structStr += `   ${key}: array<${substructName}${
          value[1] !== undefined ? `, ${~~(params as any)[key]}` : ''
        }>,\n`;
        output += wgsl.getSubStructString(value[0], substructName);
      } else if (typeof value === 'object') {
        structStr += `   ${key}: ${substructName},\n`;
        output += wgsl.getSubStructString(value, substructName);
      } else {
        structStr += `   ${key}: ${wgsl.getPrimitiveString(value)},\n`;
      }
    }
    structStr += '}';
    output += structStr;
    return output;
  }

  function nextAlign(current: number, align: number): number {
    let aligned = current - (current % align);
    if (current % align != 0) aligned += align;
    return aligned;
  }

  export function structSize<T extends Struct>(struct: T): number {
    let stride = 0;
    for (const value of Object.values(struct)) {
      const { align, size } = structValueSizeAlign(value);
      stride = nextAlign(stride, align) + size;
    }
    stride = nextAlign(stride, structAlign(struct));
    return stride;
  }

  function structValueSizeAlign(value: Primitive | Array | Struct) {
    let align: number, size: number, itemSize: number | undefined;
    if (Array.isArray(value)) {
      align = structAlign(value[0]);
      itemSize = structSize(value[0]);
      size = itemSize * value[1];
    } else if (typeof value === 'object') {
      align = structAlign(value);
      size = structSize(value);
    } else {
      ({ align, size } = PrimitiveAlignSize[value]);
    }
    return { align, size, itemSize: itemSize ?? size };
  }

  export function structAlign<T extends Struct>(struct: T): number {
    return Math.max(
      ...Object.values(struct).map(value => {
        if (Array.isArray(value)) {
          return structAlign(value[0]);
        } else if (typeof value === 'object') {
          return structAlign(value);
        } else {
          return PrimitiveAlignSize[value].align;
        }
      }),
    );
  }

  export function structView<T extends Struct>(
    buffer: ArrayBuffer,
    struct: T,
    byteOffset = 0,
  ): StructView<T> {
    const view: any = {};
    const dataView = new DataView(buffer);
    let stride = byteOffset;

    for (let [key, value] of Object.entries(struct)) {
      const { align, size, itemSize } = structValueSizeAlign(value);
      const offset = nextAlign(stride, align);

      if (Array.isArray(value)) {
        const arrayView: any[] = new Array(value[1]);
        for (let i = 0, il = value[1]; i < il; i++) {
          arrayView[i] = structView(buffer, value[0], offset + itemSize * i);
        }
        Object.freeze(arrayView);
        view[key] = arrayView;
      } else if (typeof value === 'object') {
        view[key] = structView(buffer, value, offset);
      } else {
        if (value.indexOf('_') > -1) {
          const [prefix, primitive] = value.split('_') as [string, PrimitiveNumber];
          const TypedArray = PrimitiveTypedArrayMap[primitive];
          const length = PrimitiveTypedArrayLenMap[prefix];
          view[key] = new TypedArray(buffer, offset, length);
        } else {
          const numberValue = value as PrimitiveNumber;
          const get = PrimitiveDataViewGet[numberValue];
          const set = PrimitiveDataViewSet[numberValue];
          Object.defineProperty(view, key, {
            get(): number {
              return dataView[get](offset, true);
            },
            set(v: number) {
              dataView[set](offset, v, true);
            },
          });
        }
      }

      stride = offset + size;
    }
    Object.freeze(view);
    return view as StructView<T>;
  }

  export class StructBuffer<T extends wgsl.Struct> {
    buffer: Uint8Array;
    view: StructView<NoEmptyRecord<T>>;
    constructor(public struct: NoEmptyRecord<T>) {
      const byteLength = wgsl.structSize(struct);
      this.buffer = new Uint8Array(byteLength);
      this.view = wgsl.structView(this.buffer.buffer, struct);
    }

    clone() {
      return new StructBuffer(this.struct);
    }
  }
}
