import { DEG2RAD, hFov2vFov } from './math-utils';

export function makePerspectiveHFov(
  target: Float32Array,
  hFov: number,
  aspect: number,
  near: number,
  far: number,
) {
  const vFovDeg = hFov2vFov(hFov, aspect);
  let top = (near * Math.tan(DEG2RAD * 0.5 * vFovDeg)) / 1;
  let height = 2 * top;
  let width = aspect * height;
  let left = -0.5 * width;
  makePerspective(target, left, left + width, top, top - height, near, far);
}

// prettier-ignore
export function makePerspective(target: Float32Array, left: number, right: number, top: number, bottom: number, near: number, far: number) {
  const te = target;
  const x = 2 * near / ( right - left );
  const y = 2 * near / ( top - bottom );

  const a = ( right + left ) / ( right - left );
  const b = ( top + bottom ) / ( top - bottom );
  const c = - ( far + near ) / ( far - near );
  const d = - 2 * far * near / ( far - near );

  te[ 0 ] = x;	te[ 4 ] = 0;	te[ 8 ] = a;	te[ 12 ] = 0;
  te[ 1 ] = 0;	te[ 5 ] = y;	te[ 9 ] = b;	te[ 13 ] = 0;
  te[ 2 ] = 0;	te[ 6 ] = 0;	te[ 10 ] = c;	te[ 14 ] = d;
  te[ 3 ] = 0;	te[ 7 ] = 0;	te[ 11 ] = - 1;	te[ 15 ] = 0;
}
