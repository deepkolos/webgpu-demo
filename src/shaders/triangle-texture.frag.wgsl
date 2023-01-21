@group(0) @binding(1) var colorSampler: sampler;
@group(0) @binding(2) var colorTexture: texture_2d<f32>;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    // return textureSample(colorTexture, colorSampler, uv);
    return vec4<f32>(textureSample(colorTexture, colorSampler, uv).rgb, 0.75);
}