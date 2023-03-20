import { describe, bench } from 'vitest';

describe('link with map or obj attr', () => {
  const num = 10000;
  const objList = new Array(num);
  const objLinkList = new Array(num);
  const map = new Map();
  for (let i = 0; i < num; i++) {
    objList[i] = {};
    objLinkList[i] = { i };
    map.set(objList[i], objLinkList[i]);
    objList[i].link = objLinkList[i];
  }

  bench('map', () => {
    let sum = 0;
    for (let i = 0; i < num; i++) {
      sum += map.get(objList[i]).i;
    }
  });

  bench('obj attr', () => {
    let sum = 0;
    for (let i = 0; i < num; i++) {
      sum += objList[i].link.i;
    }
  });
});

/**
✓ src/tests/map.pref.bench.ts (2) 1133ms
✓ link with map or obj attr (2) 1129ms
  name             hz     min     max    mean     p75     p99    p995    p999     rme  samples
· map        5,144.65  0.1652  0.3674  0.1944  0.1984  0.2487  0.2615  0.3221  ±0.34%     2573  
· obj attr  43,954.05  0.0172  0.1479  0.0228  0.0238  0.0371  0.0440  0.0757  ±0.24%    21978   fastest
*/
