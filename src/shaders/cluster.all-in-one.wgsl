// FIXME 改const 但是wgsl没更新到最新, 会提示报错
var<private> colors = array<vec3<f32>, 7>(
    vec3<f32>(1.0, 0.0, 0.0),
    vec3<f32>(0.0, 1.0, 0.0),
    vec3<f32>(0.0, 0.0, 1.0),
    vec3<f32>(1.0, 1.0, 0.0),
    vec3<f32>(0.0, 1.0, 1.0),
    vec3<f32>(1.0, 0.0, 1.0),
    vec3<f32>(0.0, 0.0, 0.0),
);

var<private> bottomLeftNear = vec4<f32>(-1.0, -1.0, 0.0, 1.0);
var<private> bottomLeftFar = vec4<f32>(-1.0, -1.0, 1.0, 1.0);
var<private> topRightNear = vec4<f32>(1.0, 1.0, 0.0, 1.0);
var<private> topRightFar = vec4<f32>(1.0, 1.0, 1.0, 1.0);

var<private> spritePosition = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, -1.0),
);

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

fn clipToView(clip: vec4<f32>) -> vec4<f32> {
    let view = frustum.mapping * clip;
    return view / vec4<f32>(view.w, view.w, view.w, view.w);
}

struct ScaleTranslate {
  translate: vec4<f32>,
  scale: vec4<f32>,
}
fn calcNDCToClipST(clusterId: vec3<f32>) -> ScaleTranslate {
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
            depthVSStart = fma(depthVSPerCluster, clusterId.z, view.near);
            depthVSEnd = fma(depthVSPerCluster, clusterId.z + 1.0, view.near);
            // depthVSStart = (depthVSPerCluster * clusterId.z + view.near);
            // depthVSEnd = (depthVSPerCluster * (clusterId.z + 1.0) + view.near);
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
  @location(1) clusterIndex: f32,
}

@vertex
fn frustumVertex(input: FrustumIn) -> FrustumOut {
    var output: FrustumOut;
    // x * y * z
    var clusterIndex = input.instanceIndex;
    let clusterSizeYZ = frustum.clusterSize.y * frustum.clusterSize.z;
    let clusterX = clusterIndex / clusterSizeYZ;
    let clusterY = (clusterIndex % clusterSizeYZ) / frustum.clusterSize.z;
    let clusterZ = (clusterIndex % clusterSizeYZ) % frustum.clusterSize.z;
    // z * y * x 透明绘制需要z值大的先绘制, 但是绘制cluster lights的时候结果不对, 奇怪...
    // let clusterIndex = frustum.clusterSize.y * frustum.clusterSize.z * frustum.clusterSize.x - input.instanceIndex - 1u;
    // let clusterSizeXY = frustum.clusterSize.y * frustum.clusterSize.x;
    // let clusterZ = clusterIndex / clusterSizeXY;
    // let clusterY = (clusterIndex % clusterSizeXY) / frustum.clusterSize.x;
    // let clusterX = (clusterIndex % clusterSizeXY) % frustum.clusterSize.x;
    let clusterId = vec3<f32>(f32(clusterX), f32(clusterY), f32(clusterZ));

    let scaleTranslate = calcNDCToClipST(clusterId);
    let posWorld = clipToView(fma(scaleTranslate.scale, vec4<f32>(input.position, 1.0), scaleTranslate.translate));
    // let posWorld = frustum.mapping * (scaleTranslate.scale * vec4<f32>(input.position, 1.0) + scaleTranslate.translate);

    output.position = view.projection * view.matrix * posWorld;
    // output.color = vec4<f32>(colors[clusterIndex % 6u], max(0.2, 1.0 - clusterId.z / f32(frustum.clusterSize.z)));
    output.color = vec4<f32>(colors[clusterIndex % 6u], 1.0);
    output.clusterIndex = f32(clusterIndex);

    return output;
}

@fragment
fn frustumFragment(@location(0) color: vec4<f32>, @location(1) clusterIndex: f32) -> @location(0) vec4<f32> {
    // return vec4<f32>(1.0, 1.0, 1.0, 1.0);
    let lightsInfo = clusterLights.lights[u32(clusterIndex)];
    if (lightsInfo.count == 0u) {
      discard;
    }
    return vec4<f32>(colors[6u - lightsInfo.count], clamp(f32(lightsInfo.count), 0.0, 1.0));
    // return vec4<f32>(color.xyz, clamp(f32(lightsInfo.count), 0.0, 1.0));
    // return color;
}

//////////////////////// ClusterBounds ////////////////////////

@compute @workgroup_size(64)
fn computeClusterBounds(@builtin(global_invocation_id) g_invoc_id: vec3<u32>) {
    if g_invoc_id.x >= (frustum.clusterSize.y * frustum.clusterSize.z * frustum.clusterSize.x) {
        return;
    }
    let clusterIndex = g_invoc_id.x;
    let clusterSizeYZ = frustum.clusterSize.y * frustum.clusterSize.z;
    let clusterX = clusterIndex / clusterSizeYZ;
    let clusterY = (clusterIndex % clusterSizeYZ) / frustum.clusterSize.z;
    let clusterZ = (clusterIndex % clusterSizeYZ) % frustum.clusterSize.z;
    let clusterId = vec3<f32>(f32(clusterX), f32(clusterY), f32(clusterZ));

    let st = calcNDCToClipST(clusterId);

    let bottomLeftNearVS = clipToView(fma(st.scale, bottomLeftNear, st.translate));
    let bottomLeftFarVS = clipToView(fma(st.scale, bottomLeftFar, st.translate));
    let topRightNearVS = clipToView(fma(st.scale, topRightNear, st.translate));
    let topRightFarVS = clipToView(fma(st.scale, topRightFar, st.translate));

    clusterBounds.bounds[clusterIndex].minAABB = min(min(bottomLeftNearVS, bottomLeftFarVS), min(topRightNearVS, topRightFarVS)).xyz;
    clusterBounds.bounds[clusterIndex].maxAABB = max(max(bottomLeftNearVS, bottomLeftFarVS), max(topRightNearVS, topRightFarVS)).xyz;
}

//////////////////////// ClusterLights ////////////////////////

@compute @workgroup_size(64)
fn computeClusterLights(@builtin(global_invocation_id) g_invoc_id: vec3<u32>) {
    if g_invoc_id.x >= frustum.clusterSize.y * frustum.clusterSize.z * frustum.clusterSize.x {
        return;
    }
    let clusterIndex = g_invoc_id.x;
    let bound = clusterBounds.bounds[clusterIndex];

    var clusterLightCount = 0u;
    var clusterLightIndices = array<u32, 100>();

    for (var i = 0u; i < globalLights.lightCount; i = i + 1u) {
        let range = globalLights.lights[i].range;
        var lightInCluster = range <= 0.0;

        if !lightInCluster {
            // 这里需要乘frustum world matrix invert 只是目前是identity, 所以省略了
            let lightViewPos = globalLights.lights[i].position;
            let spDist = sqDistPointAABB(lightViewPos, bound.minAABB, bound.maxAABB);
            lightInCluster = spDist <= range * range;
        }

        if lightInCluster {
            clusterLightCount = clusterLightCount + 1u;
            clusterLightIndices[clusterLightCount] = i;
        }

        if clusterLightCount == 100u {
          break;
        }
    }

    let offset = atomicAdd(&clusterLights.offset, clusterLightCount);

    for (var i = 0u; i < clusterLightCount; i = i + 1u) {
        clusterIndices.indices[offset + i] = clusterLightIndices[i];
    }
    clusterLights.lights[clusterIndex].count = clusterLightCount;
    clusterLights.lights[clusterIndex].offset = offset;
}

//////////////////////// Light Sprite ////////////////////////

struct LightSpriteIn {
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
}
struct LightSpriteOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
}

@vertex
fn lightSpriteVertex(input: LightSpriteIn) -> LightSpriteOut {
    var output: LightSpriteOut;
    let light = globalLights.lights[input.instanceIndex];
    let worldPosition = vec4<f32>(light.position, 0.0) + vec4<f32>(spritePosition[input.vertexIndex] * light.range, 0.0, 1.0);

    // output.color = vec4<f32>(light.color, 1.0);
    output.color = vec4<f32>(colors[input.vertexIndex], 1.0);
    output.position = view.projection * view.matrix * worldPosition;
    return output;
}

@fragment
fn lightSpriteFragment(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
    return color;
}
