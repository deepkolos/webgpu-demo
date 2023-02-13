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
  @location(0) color: vec4<f32>,
}

fn viewDepthToNDCDepth(depth: f32) -> f32 {
    let v3 = (frustum.projection * vec4<f32>(0.0, 0.0, depth, 1.0));
    return v3.z / v3.w;
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    // x * y * z
    // var clusterIndex = input.instanceIndex;
    // let clusterX = clusterIndex / (frustum.clusterSize.y * frustum.clusterSize.z);
    // let clusterY = (clusterIndex % (frustum.clusterSize.y * frustum.clusterSize.z)) / frustum.clusterSize.z;
    // let clusterZ = (clusterIndex % (frustum.clusterSize.y * frustum.clusterSize.z)) % frustum.clusterSize.z;
    // z * y * x 透明绘制需要z值大的先绘制
    var clusterIndex = frustum.clusterSize.y * frustum.clusterSize.z * frustum.clusterSize.x - input.instanceIndex - 1u;
    let clusterZ = clusterIndex / (frustum.clusterSize.y * frustum.clusterSize.x);
    let clusterY = (clusterIndex % (frustum.clusterSize.y * frustum.clusterSize.x)) / frustum.clusterSize.x;
    let clusterX = (clusterIndex % (frustum.clusterSize.y * frustum.clusterSize.x)) % frustum.clusterSize.x;

    let clusterId = vec3<f32>(f32(clusterX), f32(clusterY), f32(clusterZ));
    var scale = 1.0 / vec3<f32>(frustum.clusterSize);
    let posClip = vec4<f32>(input.position, 1.0);
    // x/y 居中挪到左上角, z无需位移
    let translateTopLeft = vec4<f32>(-0.5 * (1.0 - scale.xy) * 2.0, 0.0, 0.0);
    let translatePerCluster = scale * vec3<f32>(2.0, 2.0, 1.0);

    var translate: vec4<f32>;
    if frustum.depthSplitMethod == 0u {
        // ndc space even
        translate = vec4<f32>(clusterId * translatePerCluster, 0.0);
    } else {

        var depthVSStart: f32;
        var depthVSEnd: f32 ;
        if frustum.depthSplitMethod == 1u {
            // view space even 
            let depthVSPerCluster = (view.far - view.near) / f32(frustum.clusterSize.z);
            depthVSStart = fma(depthVSPerCluster, f32(clusterZ), view.near);
            depthVSEnd = fma(depthVSPerCluster, f32(clusterZ + 1u), view.near);
        } else {
            // doom-2018-siggraph
            depthVSStart = view.near * pow(view.far / view.near, f32(clusterZ) / f32(frustum.clusterSize.z));
            depthVSEnd = view.near * pow(view.far / view.near, f32(clusterZ + 1u) / f32(frustum.clusterSize.z));
        }

        // 转回NDC下z值
        let depthNDCStart = viewDepthToNDCDepth(-depthVSStart);
        scale.z = viewDepthToNDCDepth(-depthVSEnd) - depthNDCStart;
        translate = vec4<f32>(clusterId.xy * translatePerCluster.xy, depthNDCStart, 0.0);
    }

    // let posWorld = frustum.mapping * (vec4<f32>(scale, 1.0) * posClip + translateTopLeft + translate);
    let posWorld = frustum.mapping * fma(vec4<f32>(scale, 1.0), posClip, translateTopLeft + translate);

    output.position = view.projection * view.matrix * posWorld;
    // output.color = vec4<f32>(colors[(input.vertexIndex / 4u + clusterIndex) % 6u], 1.0);

    // if clusterZ % 2u == 0u {
    //   output.color = vec4<f32>(colors[clusterIndex % 6u], 0.5);
    // } else {
    //   output.color = vec4<f32>(colors[clusterIndex % 6u], 1.0);
    // }

    output.color = vec4<f32>(colors[clusterIndex % 6u], max(0.2, 1.0 - f32(clusterZ) / f32(frustum.clusterSize.z)));

    return output;
}