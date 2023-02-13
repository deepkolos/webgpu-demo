struct ClusterBounds {
  minAABB: vec3<f32>,
  maxAABB: vec3<f32>
};
@group(0) @binding(2)
var<storage, read_write> bounds: array<ClusterBounds>;

struct ClusterLights {
  offset: u32,
  length: u32,
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
@group(0) @binding(2) var<storage, read> globalLights : GlobalLightUniforms;

struct ClusterLights {
  offset: u32,
  count: u32
};
struct ClusterLightGroup {
  offset: atomic<u32>,
  lights: array<ClusterLights>, // clusterIndex -> ClusterLights
  indices: array<u32>
};
@group(0) @binding(3) var<storage, read_write> clusterLights : ClusterLightGroup;

struct ViewUniforms {
  matrix: mat4x4<f32>, // camera's world matrix invert
  projection: mat4x4<f32>,
  near: f32, // 这里应该是frustum的near far
  far: f32,
};
@group(0) @binding(0) var<uniform> view: ViewUniforms;

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

// code from https://toji.github.io/webgpu-clustered-shading/
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g_invoc_id: vec3<u32>) {
    let clusterIndex = g_invoc_id.x;
    let bound = bounds[clusterIndex];
    // input: GlobalLightUniforms
    // output: ClusterLightGroup

    var clusterLightCount = 0u;
    var clusterLightIndices = array<u32, 100>();

    for (var i = 0u; i < globalLights.lightCount; i = i + 1u) {
      let range = globalLights.lights[i].range;
      var lightInCluster = range <= 0.0;

      if (!lightInCluster) {
        let lightViewPos = view.matrix * vec4<f32>(globalLights.lights[i].position, 1.0);
        let spDist = sqDistPointAABB(lightViewPos.xyz, bound.minAABB, bound.maxAABB);
        lightInCluster = spDist <= (range * range);
      }

      if (lightInCluster) {
        clusterLightCount = clusterLightCount + 1u;
        clusterLightIndices[clusterLightCount] = i;
      }
    }

    let offset = atomicAdd(&clusterLights.offset, clusterLightCount);

    for (var i = 0u; i < clusterLightCount; i = i + 1u) {
      clusterLights.indices[offset + i] = clusterLightIndices[i];
    }
    clusterLights.lights[clusterIndex].length = clusterLightCount;
    clusterLights.lights[clusterIndex].offset = offset;
}