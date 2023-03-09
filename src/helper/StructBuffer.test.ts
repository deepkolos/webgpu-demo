import { wgsl } from './StructBuffer';
import { expect, test } from 'vitest';

test('StructBuffer simple', () => {
  const struct = new wgsl.StructBuffer({
    ambient: 'vec3_f32',
    lightCount: 'u32',
    lights: [
      {
        position: 'vec3_f32',
        range: 'f32',
        color: 'vec3_f32',
        intensity: 'f32',
      },
      4,
    ],
  });

  let i = 0;
  struct.view.ambient.set([++i, ++i, ++i]);
  struct.view.lightCount = ++i;
  struct.view.lights.forEach(light => {
    light.color.set([++i, ++i, ++i]);
    light.position.set([++i, ++i, ++i]);
    light.intensity = ++i;
    light.range = ++i;
  });

  // console.log(struct.view);
  // console.log(struct.buffer);

  i = 0;
  expect(struct.view.ambient).toStrictEqual(new Float32Array([++i, ++i, ++i]));
  expect(struct.view.lightCount).toStrictEqual(++i);
  struct.view.lights.forEach(light => {
    expect(light.color).toStrictEqual(new Float32Array([++i, ++i, ++i]));
    expect(light.position).toStrictEqual(new Float32Array([++i, ++i, ++i]));
    expect(light.intensity).toStrictEqual(++i);
    expect(light.range).toStrictEqual(++i);

    expect(() => (light.color = new Float32Array())).toThrowError();
  });

  expect(() => (struct.view.lights[2] = {} as any)).toThrowError();
  expect(() => (struct.view.lights[4] = {} as any)).toThrowError();
});

test('StructBuffer view', () => {
  // further wgsl struct test in DemoStructBuffer
  const { view } = new wgsl.StructBuffer({
    u32_: 'u32',
    i32_: 'i32',
    f32_: 'f32',
    vec2_: 'vec2_f32',
    vec3_: 'vec3_f32',
    vec4_: 'vec4_f32',
    mat3_: 'mat3x3_f32',
    mat4_: 'mat4x4_f32',
    substruct: {
      vec2_0: 'vec2_f32',
      vec2_1: 'vec2_f32',
      subarray: [
        {
          f32_: 'f32',
          i32_: 'i32',
        },
        2,
      ],
    },
    subarray: [
      {
        vec2_0: 'vec2_f32',
        vec2_1: 'vec2_f32',
        subarray: [
          {
            f32_: 'f32',
            i32_: 'i32',
          },
          2,
        ],
      },
      2,
    ],
  });
  view.f32_ = 1;
  view.i32_ = 2;
  view.u32_ = -1;
  expect(view.f32_).toBe(1);
  expect(view.i32_).toBe(2);
  expect(view.u32_).toBe(4294967295);

  expect(view.vec2_.length).toBe(2);
  expect(view.vec2_.byteOffset).toBe(4 * 4);
  expect(view.vec3_.length).toBe(3);
  expect(view.vec3_.byteOffset).toBe(4 * (4 + 4));
  expect(view.vec4_.length).toBe(4);
  expect(view.vec4_.byteOffset).toBe(4 * (4 + 4 + 4));
  expect(view.mat3_.length).toBe(12);
  expect(view.mat3_.byteOffset).toBe(4 * (4 + 4 + 4 + 4));
  expect(view.mat4_.length).toBe(16);
  expect(view.mat4_.byteOffset).toBe(4 * (4 + 4 + 4 + 4 + 4 * 3));
  expect(view.substruct.subarray.length).toBe(2);
  expect(view.subarray.length).toBe(2);
  expect(view.subarray[0].subarray.length).toBe(2);
});

test('StructBuffer ignore align', () => {
  const { view, buffer } = new wgsl.StructBuffer(
    {
      a: 'vec2_f32',
      b: 'vec3_f32',
      c: 'vec4_f32',
      d: 'f32',
      e: 'mat3x3_f32',
      f: 'mat4x4_f32',
    },
    true,
  );

  expect(view.a.byteOffset).toBe(0);
  expect(view.b.byteOffset).toBe(4 * 2);
  expect(view.c.byteOffset).toBe(4 * 5);
  expect(view.e.byteOffset).toBe(4 * 10);
  expect(view.f.byteOffset).toBe(4 * 22);
});

test('StructBuffer stringifyStruct', () => {
  const substruct = wgsl.struct({
    vec2_0: 'vec2_f32',
    vec2_1: 'vec2_f32',
    subarray: [
      {
        f32_: 'f32',
        i32_: 'i32',
      },
      2,
    ],
  });
  const str = wgsl.stringifyStruct('Test', {
    u32_: 'u32',
    i32_: 'i32',
    f32_: 'f32',
    vec2_: 'vec2_f32',
    vec3_: 'vec3_f32',
    vec4_: 'vec4_f32',
    mat3_: 'mat3x3_f32',
    mat4_: 'mat4x4_f32',
    substruct,
    subarray: [substruct, 2],
  });
  console.log(str);
  expect(str).toBe(`struct Test_substruct_subarray {
  f32_: f32,
  i32_: i32,
};
struct Test_substruct {
  vec2_0: vec2<f32>,
  vec2_1: vec2<f32>,
  subarray: array<Test_substruct_subarray, 2>,
};
struct Test {
  u32_: u32,
  i32_: i32,
  f32_: f32,
  vec2_: vec2<f32>,
  vec3_: vec3<f32>,
  vec4_: vec4<f32>,
  mat3_: mat3x3<f32>,
  mat4_: mat4x4<f32>,
  substruct: Test_substruct,
  subarray: array<Test_subarray, 2>,
};`)
});
