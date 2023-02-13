var<private> colors = array<vec3<f32>, 6>(
    vec3<f32>(1.0, 0.0, 0.0),
    vec3<f32>(0.0, 1.0, 0.0),
    vec3<f32>(0.0, 0.0, 1.0),
    vec3<f32>(1.0, 1.0, 0.0),
    vec3<f32>(0.0, 1.0, 1.0),
    vec3<f32>(1.0, 0.0, 1.0),
);

var<private> bottomLeftNear = vec4<f32>(-1.0, -1.0, 0.0, 1.0);
var<private> bottomLeftFar = vec4<f32>(-1.0, -1.0, 1.0, 1.0);
var<private> topRightNear = vec4<f32>(1.0, 1.0, 0.0, 1.0);
var<private> topRightFar = vec4<f32>(1.0, 1.0, 1.0, 1.0);

struct ViewUniforms {
  matrix: mat4x4<f32>, // camera's world matrix invert
  projection: mat4x4<f32>,
  near: f32, // 这里应该是frustum的near far
  far: f32,
};
struct FrustumUniforms {
  mapping: mat4x4<f32>, // Frustum's projectionInvert
  projection: mat4x4<f32>, // Frustum's projection
  clusterSize: vec3<u32>,
  depthSplitMethod: u32, // 0 dnc-even 1 world-even 2 
};
struct ClusterBound {
  minAABB: vec3<f32>,
  maxAABB: vec3<f32>
};
struct ClusterBounds {
  bounds: array<ClusterBound>,
};
struct Light {
  position: vec3<f32>,
  range: f32,
  color: vec3<f32>,
  intensity: f32
};
struct GlobalLightUniforms {
  ambient: vec3<f32>,
  lightCount: u32,
  lights: array<Light>
};
struct ClusterLightInfo {
  offset: u32,
  count: u32
};
struct ClusterLights {
  offset: atomic<u32>,
  lights: array<ClusterLightInfo>, // enable runtime size
};
struct ClusterLightsIndices {
  indices: array<u32>,
}

@group(0) @binding(0) var<uniform> view: ViewUniforms; 
@group(0) @binding(1) var<uniform> frustum: FrustumUniforms; 
@group(0) @binding(2) var<storage, read_write> clusterBounds: ClusterBounds;
@group(0) @binding(3) var<storage, read> globalLights: GlobalLightUniforms;
@group(0) @binding(4) var<storage, read_write> clusterLights: ClusterLights;
@group(0) @binding(5) var<storage, read_write> clusterIndices: ClusterLightsIndices;

fn viewDepthToNDCDepth(depth: f32) -> f32 {
    let v3 = (frustum.projection * vec4<f32>(0.0, 0.0, depth, 1.0));
    return v3.z / v3.w;
}

struct ScaleTranslate {
  translate: vec4<f32>,
  scale: vec4<f32>,
}
fn calcNDCToViewST(clusterId: vec3<f32>) -> ScaleTranslate {
    var scale = 1.0 / vec3<f32>(frustum.clusterSize);
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
            // depthVSStart = fma(depthVSPerCluster, clusterId.z, view.near);
            // depthVSEnd = fma(depthVSPerCluster, clusterId.z + 1.0, view.near);
            depthVSStart = (depthVSPerCluster * clusterId.z + view.near);
            depthVSEnd = (depthVSPerCluster * (clusterId.z + 1.0) + view.near);
        } else {
            // doom-2018-siggraph
            depthVSStart = view.near * pow(view.far / view.near, clusterId.z / f32(frustum.clusterSize.z));
            depthVSEnd = view.near * pow(view.far / view.near, (clusterId.z + 1.0) / f32(frustum.clusterSize.z));
        }

        // 转回NDC下z值
        let depthNDCStart = viewDepthToNDCDepth(-depthVSStart);
        scale.z = viewDepthToNDCDepth(-depthVSEnd) - depthNDCStart;
        translate = vec4<f32>(clusterId.xy * translatePerCluster.xy, depthNDCStart, 0.0);
    }

    var out: ScaleTranslate;
    out.scale = vec4<f32>(scale, 1.0);
    out.translate = translate + translateTopLeft;
    return out;
}

// the most popular algorithm to determine whether an AABB intersects with a solid sphere or not by Jim Arvo, in "Graphics Gems":
// https://stackoverflow.com/questions/28343716/sphere-intersection-test-of-aabb
fn sqDistPointAABB(point: vec3<f32>, minAABB: vec3<f32>, maxAABB: vec3<f32>) -> f32 {
    var sqDist = 0.0;

    for (var i = 0; i < 3; i = i + 1) {
        let v = point[i];
        if v < minAABB[i] {
            sqDist = sqDist + (minAABB[i] - v) * (minAABB[i] - v);
        }
        if v > maxAABB[i] {
            sqDist = sqDist + (v - maxAABB[i]) * (v - maxAABB[i]);
        }
    }

    return sqDist;
}

//////////////////////// Frustum ////////////////////////

struct FrustumIn {
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
  @location(0) position: vec3<f32>,
}
struct FrustumOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
}

@vertex
fn frustumVertex(input: FrustumIn) -> FrustumOut {
    var output: FrustumOut;
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

    let scaleTranslate = calcNDCToViewST(clusterId);
    // let posWorld = frustum.mapping * fma(scaleTranslate.scale, vec4<f32>(input.position, 1.0), scaleTranslate.translate);
    let posWorld = frustum.mapping * (scaleTranslate.scale * vec4<f32>(input.position, 1.0) + scaleTranslate.translate);

    output.position = view.projection * view.matrix * posWorld;
    output.color = vec4<f32>(colors[clusterIndex % 6u], max(0.2, 1.0 - clusterId.z / f32(frustum.clusterSize.z)));
    // output.color = vec4<f32>(colors[(input.vertexIndex / 4u + clusterIndex) % 6u], 1.0);
    // output.color = vec4<f32>(colors[clusterIndex % 6u], 1.0);

    // if clusterZ % 2u == 0u {
    //   output.color = vec4<f32>(colors[clusterIndex % 6u], 0.5);
    // } else {
    //   output.color = vec4<f32>(colors[clusterIndex % 6u], 1.0);
    // }

    // output.position = vec4<f32>(output.position.x, output.position.y, output.position.z, 1.0);
    // output.position = vec4<f32>(input.position * 0.5, 1.0);
    // output.position = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    // output.color = vec4<f32>(1.0);

    return output;
}

@fragment
fn frustumFragment(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
    // return vec4<f32>(1.0, 1.0, 1.0, 1.0);
    return color;
}

//////////////////////// ClusterBounds ////////////////////////

@compute @workgroup_size(64)
fn computeClusterBounds(@builtin(global_invocation_id) g_invoc_id: vec3<u32>) {
    let clusterIndex = g_invoc_id.x;
    let clusterSizeXY = frustum.clusterSize.y * frustum.clusterSize.z;
    let clusterX = clusterIndex / clusterSizeXY;
    let clusterY = (clusterIndex % clusterSizeXY) / frustum.clusterSize.z;
    let clusterZ = (clusterIndex % clusterSizeXY) % frustum.clusterSize.z;
    let clusterId = vec3<f32>(f32(clusterX), f32(clusterY), f32(clusterZ));

    let st = calcNDCToViewST(clusterId);

    let bottomLeftNearVS = frustum.mapping * fma(st.scale, bottomLeftNear, st.translate);
    let bottomLeftFarVS = frustum.mapping * fma(st.scale, bottomLeftFar, st.translate);
    let topRightNearVS = frustum.mapping * fma(st.scale, topRightNear, st.translate);
    let topRightFarVS = frustum.mapping * fma(st.scale, topRightFar, st.translate);

    clusterBounds.bounds[clusterIndex].minAABB = min(min(bottomLeftNearVS, bottomLeftFarVS), min(topRightNearVS, topRightFarVS)).xyz;
    clusterBounds.bounds[clusterIndex].maxAABB = max(max(bottomLeftNearVS, bottomLeftFarVS), max(topRightNearVS, topRightFarVS)).xyz;
}

//////////////////////// ClusterLights ////////////////////////

@compute @workgroup_size(64)
fn computeClusterLights(@builtin(global_invocation_id) g_invoc_id: vec3<u32>) {
    let clusterIndex = g_invoc_id.x;
    let bound = clusterBounds.bounds[clusterIndex];

    var clusterLightCount = 0u;
    var clusterLightIndices = array<u32, 100>();

    for (var i = 0u; i < globalLights.lightCount; i = i + 1u) {
        let range = globalLights.lights[i].range;
        var lightInCluster = range <= 0.0;

        if !lightInCluster {
            let lightViewPos = view.matrix * vec4<f32>(globalLights.lights[i].position, 1.0);
            let spDist = sqDistPointAABB(lightViewPos.xyz, bound.minAABB, bound.maxAABB);
            lightInCluster = spDist <= (range * range);
        }

        if lightInCluster {
            clusterLightCount = clusterLightCount + 1u;
            clusterLightIndices[clusterLightCount] = i;
        }
    }

    let offset = atomicAdd(&clusterLights.offset, clusterLightCount);

    for (var i = 0u; i < clusterLightCount; i = i + 1u) {
        clusterIndices.indices[offset + i] = clusterLightIndices[i];
    }
    clusterLights.lights[clusterIndex].count = clusterLightCount;
    clusterLights.lights[clusterIndex].offset = offset;
}

//////////////////////// Shading ////////////////////////
