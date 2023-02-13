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

struct ClusterBounds {
  minAABB: vec3<f32>,
  maxAABB: vec3<f32>
};
@group(0) @binding(2)
var<storage, read_write> bounds: array<ClusterBounds>;

var<private> bottomLeftNear: vec4<f32> = vec4<f32>(-1.0, -1.0, 0.0, 1.0);
var<private> bottomLeftFar: vec4<f32> = vec4<f32>(-1.0, -1.0, 1.0, 1.0);
var<private> topRightNear: vec4<f32> = vec4<f32>(1.0, 1.0, 0.0, 1.0);
var<private> topRightFar: vec4<f32> = vec4<f32>(1.0, 1.0, 1.0, 1.0);

fn viewDepthToNDCDepth(depth: f32) -> f32 {
    let v3 = (frustum.projection * vec4<f32>(0.0, 0.0, depth, 1.0));
    return v3.z / v3.w;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g_invoc_id: vec3<u32>) {
    let clusterIndex = g_invoc_id.x;
    let clusterSizeXY = frustum.clusterSize.y * frustum.clusterSize.z;
    let clusterX = clusterIndex / clusterSizeXY;
    let clusterY = (clusterIndex % clusterSizeXY) / frustum.clusterSize.z;
    let clusterZ = (clusterIndex % clusterSizeXY) % frustum.clusterSize.z;
    let clusterId = vec3<f32>(f32(clusterX), f32(clusterY), f32(clusterZ));

    var scale = 1.0 / vec3<f32>(frustum.clusterSize);
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

        let depthNDCStart = viewDepthToNDCDepth(-depthVSStart);
        scale.z = viewDepthToNDCDepth(-depthVSEnd) - depthNDCStart;
        translate = vec4<f32>(clusterId.xy * translatePerCluster.xy, depthNDCStart, 0.0);
    }

    translate = translate + translateTopLeft;
    let scaleV4 = vec4<f32>(scale, 1.0);

    // let bottomLeftNearVS = frustum.mapping * (scaleV4 * bottomLeftNear + translate);
    let bottomLeftNearVS = frustum.mapping * fma(scaleV4, bottomLeftNear, translate);
    let bottomLeftFarVS = frustum.mapping * fma(scaleV4, bottomLeftFar, translate);
    let topRightNearVS = frustum.mapping * fma(scaleV4, topRightNear, translate);
    let topRightFarVS = frustum.mapping * fma(scaleV4, topRightFar, translate);

    bounds[clusterIndex].minAABB = min(min(bottomLeftNearVS, bottomLeftFarVS),min(topRightNearVS, topRightFarVS)).xyz;
    bounds[clusterIndex].maxAABB = max(max(bottomLeftNearVS, bottomLeftFarVS),max(topRightNearVS, topRightFarVS)).xyz;
}