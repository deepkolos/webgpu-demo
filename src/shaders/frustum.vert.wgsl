var<private> colors = array<vec3<f32>, 6>(
  vec3<f32>(1.0, 0.0, 0.0),
  vec3<f32>(0.0, 1.0, 0.0),
  vec3<f32>(0.0, 0.0, 1.0),
  vec3<f32>(1.0, 1.0, 0.0),
  vec3<f32>(0.0, 1.0, 1.0),
  vec3<f32>(1.0, 0.0, 1.0),
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
  @location(0) position: vec3<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    let pos_clip = vec4<f32>(input.position, 1.0);
    let pos_world = frustum.mapping * pos_clip;

    output.position = view.projection * view.matrix * pos_world;
    output.color = colors[(input.vertexIndex / 4u) % 6u];

    return output;
}