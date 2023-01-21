export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

function degToRad(degrees: number) {
  return degrees * DEG2RAD;
}

function radToDeg(radians: number) {
  return radians * RAD2DEG;
}
export function vFov2hFov(vFovDeg: number, aspect: number) {
  const tanVFovHalf = Math.tan(degToRad(vFovDeg * 0.5)) * aspect;
  return radToDeg(2 * Math.atan(tanVFovHalf));
}

export function hFov2vFov(hFovDeg: number, aspect: number) {
  const tanVFovHalf = Math.tan(degToRad(hFovDeg * 0.5)) / aspect;
  return radToDeg(2 * Math.atan(tanVFovHalf));
}
