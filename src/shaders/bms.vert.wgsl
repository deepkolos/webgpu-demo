struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct UBO {
  width: f32,
  offsetX: f32,
  listLen: f32,
};
@group(0) @binding(0) var<uniform> ubo: UBO;

@vertex
fn main(@location(0) position: vec2<f32>, @location(1) uv: vec2<f32>) -> VSOut {
    var out: VSOut;
    let x = position.x * ubo.width - (1.0 - ubo.width) + ubo.offsetX;
    out.position = vec4<f32>(x, position.y, 0.0, 1.0);
    out.uv = uv;
    return out;
}