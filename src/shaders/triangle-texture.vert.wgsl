struct VSOut {
    @builtin(position) Position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

struct UBO {
  modelViewProj: mat4x4<f32>,
  primaryColor: vec4<f32>,
  accentColor: vec4<f32>
};

@group(0) @binding(0)
var<uniform> uniforms: UBO;

@vertex
fn main(@location(0) inPos: vec3<f32>,
        @location(1) inUv: vec2<f32>) -> VSOut {
    var vsOut: VSOut;
    vsOut.Position = uniforms.modelViewProj * vec4<f32>(inPos, 1.0);
    vsOut.uv = inUv;
    return vsOut;
}