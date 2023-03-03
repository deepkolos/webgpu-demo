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
