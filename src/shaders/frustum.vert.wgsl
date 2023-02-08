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
  projection: mat4x4<f32>, // Frustum's projection
  clusterSize: vec3<u32>,
  depthSplitMethod: u32, // 0 dnc-even 1 world-even 2 
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

    let clusterX = input.instanceIndex / (frustum.clusterSize.y * frustum.clusterSize.z);
    let clusterY = (input.instanceIndex % (frustum.clusterSize.y * frustum.clusterSize.z)) / frustum.clusterSize.z;
    let clusterZ = (input.instanceIndex % (frustum.clusterSize.y * frustum.clusterSize.z)) % frustum.clusterSize.z;
    let clusterId = vec3<f32>(f32(clusterX), f32(clusterY), f32(clusterZ));
    let posClip = vec4<f32>(input.position, 1.0);

    var posWorld: vec4<f32>;
    if frustum.depthSplitMethod == 0u {
        let scale = vec3<f32>(1.0, 1.0, 1.0) / vec3<f32>(frustum.clusterSize);
        // x/y 居中挪到左上角, z无需位移
        let translateTopLeft = vec4<f32>(-0.5 * (1.0 - scale.xy) * 2.0, 0.0, 0.0);
        let translatePerCluster = scale * vec3<f32>(2.0, 2.0, 1.0);
        let translate = translateTopLeft + vec4<f32>(clusterId * translatePerCluster, 0.0);
        posWorld = frustum.mapping * (vec4<f32>(scale, 1.0) * posClip + translate);
    } else if frustum.depthSplitMethod == 1u {
        // posWorld = frustum.mapping * posClip;
    } else {
    }

    output.position = view.projection * view.matrix * posWorld;
    // output.color = colors[(input.vertexIndex / 4u + input.instanceIndex) % 6u];
    output.color = colors[input.instanceIndex % 6u];

    return output;
}