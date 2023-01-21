
struct UBOPerInstance {
  width: f32,
  friction: f32,
  gravity: f32,
  indexSeed: f32,
  weights: vec3<f32>,
  padding_weights: f32,
  colors: array<vec4<f32>, 4>,
}; // 6 * 4 = 24

struct UBOPerFrame {
  opacity: f32,
  padding: f32, // 必须, 否则后面drawRange数据不对...
  drawRange: vec2<f32>,
  projectionMatrix: mat4x4<f32>,
  modelViewMatrix: mat4x4<f32>,
}; // 4 + 16 + 16

@group(0) @binding(0)
var<uniform> uniformPerInstance: UBOPerInstance;

@group(0) @binding(1)
var<uniform> uniformPerFrame: UBOPerFrame;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
};

fn rand(co: vec2<f32>) -> f32 {
    return fract(sin(dot(co, vec2<f32>(12.9898, 78.233))) * 8.5453);
}

@vertex
fn main(@location(0) frameId: f32, @location(1) lineIndex: f32, @location(2) v: f32, @location(3) angle: f32) -> VSOut {
    var out: VSOut;

    // let v_ = 5.867113634929736;
    // let angle_ = 0.7853981633974483;
    // let vx = v_ * cos(angle_);
    // let vy = v_ * sin(angle_);
    let vx = v * cos(angle);
    let vy = v * sin(angle);
    // let frameId = 3f;
    let frameIndex = floor(frameId * 0.5);
    let n = frameIndex;
    let a1 = uniformPerInstance.friction;
    let q = uniformPerInstance.friction;
    let a1DivQ = a1 / (1.0f - q);
    let powQN = pow(q, n);
    let sn = a1DivQ * (1.0f - powQN);
    let x = vx * sn;
    let y = vy * sn - uniformPerInstance.gravity * (a1DivQ * (n - sn));
    let vxn = vx * powQN;
    let vyn = vy * powQN - uniformPerInstance.gravity * a1DivQ * (1.0 - powQN);

    let seed3 = rand(vec2<f32>(lineIndex, lineIndex * 1.234));
    // let seed3 = 0f;
    let uvInterpolation = (frameIndex + seed3 - uniformPerFrame.drawRange[0]) / (uniformPerFrame.drawRange[1] + seed3 - uniformPerFrame.drawRange[0]);
    let colorInterpolation = (frameIndex + seed3 - uniformPerFrame.drawRange[0]) / uniformPerFrame.drawRange[1];
    let side = -sign(fract(frameId * 0.5) - 0.25);
    // let side = 1f;
    // let normal0 = normalize(vec2<f32>(vxn, vyn));
    // let normal1= vec2<f32>(-normal0.y, normal0.x);
    let normal1 = normalize(vec2<f32>(-vyn, vxn));
    let normal = normal1 * uniformPerInstance.width * uvInterpolation * 3.0;
    // let normal = normal1 * uniformPerInstance.width * 3.0;
    // let finalPosition = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    let finalPosition = vec4<f32>(vec2<f32>(x, y) + normal.xy * side, 0.0, 1.0);
    // let finalPosition = vec4<f32>((vec2<f32>(x, y) + normal.xy * side) * 0.01, 0.0, 1.0);

    // out.position = projectionMatrix * modelViewMatrix * finalPosition;
    // out.position = uniformPerFrame.projectionMatrix * finalPosition;
    out.position = uniformPerFrame.projectionMatrix * uniformPerFrame.modelViewMatrix * finalPosition;
    // out.position = finalPosition;
    // out.position = vec4<f32>(0.0, 0.0, 0.0, 1.0);

    out.uv = vec2<f32>(uvInterpolation, side * 0.5 + 0.5);

    let colorProgress = pow(1.0 - colorInterpolation, 2.0); // easein

    let stepColor1 = step(uniformPerInstance.weights.x, colorProgress);
    let stepColor2 = step(uniformPerInstance.weights.y + uniformPerInstance.weights.x, colorProgress);
    let stepColor3 = step(uniformPerInstance.weights.y + uniformPerInstance.weights.x + uniformPerInstance.weights.z, colorProgress);

    let colorIndex = i32(stepColor1 + stepColor2 + stepColor3);
    let colorFactor = 1.0 - fract(
        smoothstep(uniformPerInstance.weights.x + 0.0001, 0.0, colorProgress) 
      + smoothstep(uniformPerInstance.weights.y + 0.0001, 0.0, colorProgress - uniformPerInstance.weights.x) 
      + smoothstep(uniformPerInstance.weights.z + 0.0001, 0.0, colorProgress - uniformPerInstance.weights.x - uniformPerInstance.weights.y)
    );
    let c = uniformPerInstance.colors[colorIndex] + (uniformPerInstance.colors[colorIndex + 1] - uniformPerInstance.colors[colorIndex]) * colorFactor;
    out.color = vec4<f32>(c.xyz, uniformPerFrame.opacity);
    // out.color = vec4<f32>(out.uv, 0.0, 1.0);
    // out.color = vec4<f32>(1.0, 1.0, 1.0, 1.0);
    return out;
}
