@group(0) @binding(1)
var<storage, read> list: array<f32>;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let listLen = arrayLength(&list);
    let index = u32(f32(listLen) * uv.y);
    return vec4<f32>(list[index] / f32(listLen), 0.0, 0.0, 1.0);
}