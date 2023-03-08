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
        @location(1) inUv: vec2<f32>,
        @location(2) inVec2: vec2<f32>,
        @location(3) inVec3: vec3<f32>,
        @location(4) inVec4: vec4<f32>,) -> VSOut {
    var vsOut: VSOut;
    // 用于测试vertexbuffer是否有align要求: 否
    let preventOpt = vec4<f32>(0.0) * vec4<f32>(inVec2, 0.0, 0.0) * vec4<f32>(inVec3, 0.0) * inVec4;
    vsOut.Position = uniforms.modelViewProj * vec4<f32>(inPos, 1.0) + preventOpt;
    vsOut.uv = inUv;
    return vsOut;
}