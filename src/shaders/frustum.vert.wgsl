// @see https://stackoverflow.com/questions/28375338/cube-using-single-gl-triangle-strip
// WebGPU zRange is [0, 1] so need to change z: -1->0
var<private> cube_strip = array<vec3<f32>, 14>(
    vec3<f32>(-1.0, 1.0, 1.0),  // Front-top-left
    vec3<f32>(1.0, 1.0, 1.0),   // Front-top-right
    vec3<f32>(-1.0, -1.0, 1.0), // Front-bottom-left
    vec3<f32>(1.0, -1.0, 1.0),  // Front-bottom-right
    vec3<f32>(1.0, -1.0, 0.0), // Back-bottom-right
    vec3<f32>(1.0, 1.0, 1.0),   // Front-top-right
    vec3<f32>(1.0, 1.0, 0.0),  // Back-top-right
    vec3<f32>(-1.0, 1.0, 1.0),  // Front-top-left
    vec3<f32>(-1.0, 1.0, 0.0), // Back-top-left
    vec3<f32>(-1.0, -1.0, 1.0), // Front-bottom-left
    vec3<f32>(-1.0, -1.0, 0.0),// Back-bottom-left
    vec3<f32>(1.0, -1.0, 0.0), // Back-bottom-right
    vec3<f32>(-1.0, 1.0, 0.0), // Back-top-left
    vec3<f32>(1.0, 1.0, 0.0),  // Back-top-right
);

var<private> pos = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0)
);

var<private> colors = array<vec3<f32>, 5>(
  vec3<f32>(1.0, 0.0, 0.0),
  vec3<f32>(0.0, 1.0, 0.0),
  vec3<f32>(1.0, 0.0, 1.0),
  vec3<f32>(1.0, 1.0, 0.0),
  vec3<f32>(0.0, 1.0, 1.0),
);

struct ViewUniforms {
  matrix: mat4x4<f32>, // camera's world matrix invert
  projection: mat4x4<f32>,
  near: f32,
  far: f32,
};
@group(0) @binding(0) var<uniform> view: ViewUniforms;

struct FrustumUniforms {
  mapping: mat4x4<f32>, // Frustum's projectionInvert
  clusterSize: vec3<u32>,
};
@group(0) @binding(1) var<uniform> frustum: FrustumUniforms;

struct VertexInput {
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    let pos_clip = vec4<f32>(cube_strip[input.vertexIndex], 1.0);
    let pos_world = frustum.mapping * pos_clip;

    output.position = view.projection * view.matrix * pos_world;
    output.color = vec3(pos_clip.xy * 0.5 + 0.5, pos_clip.z);
    // output.color = colors[input.vertexIndex % 5u];

    return output;
}