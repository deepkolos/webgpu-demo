@group(0) @binding(2) var colorSampler: sampler;
@group(0) @binding(3) var colorTexture: texture_2d<f32>;

@fragment
fn main(@location(0) uv: vec2<f32>, @location(1) color: vec4<f32>) -> @location(0) vec4<f32> {
    let out = color * textureSample(colorTexture, colorSampler, uv);
    return vec4<f32>(out.rgb, clamp(out.a * 1.5, 0.0, 1.0));
    // return color;
}