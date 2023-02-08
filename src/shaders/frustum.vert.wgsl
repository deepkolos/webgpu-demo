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
  near: f32, // 这里应该是frustum的near far
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
    var clusterIndex = input.instanceIndex;
    let clusterX = clusterIndex / (frustum.clusterSize.y * frustum.clusterSize.z);
    let clusterY = (clusterIndex % (frustum.clusterSize.y * frustum.clusterSize.z)) / frustum.clusterSize.z;
    let clusterZ = (clusterIndex % (frustum.clusterSize.y * frustum.clusterSize.z)) % frustum.clusterSize.z;
    let clusterId = vec3<f32>(f32(clusterX), f32(clusterY), f32(clusterZ));
    let posClip = vec4<f32>(input.position, 1.0);

    var posWorld: vec4<f32>;
    if frustum.depthSplitMethod == 0u {

        let scale = 1.0 / vec3<f32>(frustum.clusterSize);
        // x/y 居中挪到左上角, z无需位移
        let translateTopLeft = vec4<f32>(-0.5 * (1.0 - scale.xy) * 2.0, 0.0, 0.0);
        let translatePerCluster = scale * vec3<f32>(2.0, 2.0, 1.0);
        let translate = translateTopLeft + vec4<f32>(clusterId * translatePerCluster, 0.0);
        posWorld = frustum.mapping * (vec4<f32>(scale, 1.0) * posClip + translate);
    } else if frustum.depthSplitMethod == 1u {

        let depthVSPerCluster = (view.far - view.near) / f32(frustum.clusterSize.z);
        let depthVSStart = view.near + depthVSPerCluster * f32(clusterZ);
        let depthVSEnd = view.near + depthVSPerCluster * f32(clusterZ + 1u);
        // 转会NDC下z值
        let depthNDCStartV3 = (frustum.projection * vec4<f32>(0.0, 0.0, -depthVSStart, 1.0));
        let depthNDCEndV3 = (frustum.projection * vec4<f32>(0.0, 0.0, -depthVSEnd, 1.0));
        let depthNDCStart = depthNDCStartV3.z / depthNDCStartV3.w;
        let depthNDCEnd = depthNDCEndV3.z / depthNDCEndV3.w;
        var scale = 1.0 / vec3<f32>(frustum.clusterSize);
        // 透视除法之后才是ndc depth
        scale.z = depthNDCEnd - depthNDCStart;

        let translateTopLeft = vec4<f32>(-0.5 * (1.0 - scale.xy) * 2.0, 0.0, 0.0);
        let translatePerCluster = scale * vec3<f32>(2.0, 2.0, 1.0);
        let translate = translateTopLeft + vec4<f32>(clusterId.xy * translatePerCluster.xy, depthNDCStart, 0.0);
        posWorld = frustum.mapping * (vec4<f32>(scale, 1.0) * posClip + translate);
    } else {

        let depthVSStart = view.near * pow(view.far / view.near, f32(clusterZ) / f32(frustum.clusterSize.z));
        let depthVSEnd = view.near * pow(view.far / view.near, f32(clusterZ + 1u) / f32(frustum.clusterSize.z));
        // 转会NDC下z值
        let depthNDCStartV3 = (frustum.projection * vec4<f32>(0.0, 0.0, -depthVSStart, 1.0));
        let depthNDCEndV3 = (frustum.projection * vec4<f32>(0.0, 0.0, -depthVSEnd, 1.0));
        let depthNDCStart = depthNDCStartV3.z / depthNDCStartV3.w;
        let depthNDCEnd = depthNDCEndV3.z / depthNDCEndV3.w;
        var scale = 1.0 / vec3<f32>(frustum.clusterSize);
        // 透视除法之后才是ndc depth
        scale.z = depthNDCEnd - depthNDCStart;

        let translateTopLeft = vec4<f32>(-0.5 * (1.0 - scale.xy) * 2.0, 0.0, 0.0);
        let translatePerCluster = scale * vec3<f32>(2.0, 2.0, 1.0);
        let translate = translateTopLeft + vec4<f32>(clusterId.xy * translatePerCluster.xy, depthNDCStart, 0.0);
        posWorld = frustum.mapping * (vec4<f32>(scale, 1.0) * posClip + translate);
    }

    output.position = view.projection * view.matrix * posWorld;
    // output.color = colors[(input.vertexIndex / 4u + clusterIndex) % 6u];
    output.color = colors[clusterIndex % 6u];

    return output;
}