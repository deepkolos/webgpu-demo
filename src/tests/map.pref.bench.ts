import { describe, bench } from 'vitest';

describe('link with map or obj attr', () => {
  const num = 10000;
  const objList = new Array(num);
  const objLinkList = new Array(num);
  const map = new Map();
  const weakmap = new WeakMap();
  for (let i = 0; i < num; i++) {
    objList[i] = {};
    objLinkList[i] = { i };
    map.set(objList[i], objLinkList[i]);
    weakmap.set(objList[i], objLinkList[i]);
    objList[i].link = objLinkList[i];
  }

  bench('weakmap', () => {
    let sum = 0;
    for (let i = 0; i < num; i++) {
      sum += weakmap.get(objList[i]).i;
    }
  });

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
 ✓ src/tests/map.pref.bench.ts (3) 1638ms
   ✓ link with map or obj attr (3) 1634ms
     name             hz     min     max    mean     p75     p99    p995    p999     rme  samples
   · weakmap    4,744.19  0.1909  0.4996  0.2108  0.2155  0.2965  0.3199  0.3674  ±0.47%     2373   slowest
   · map        4,840.40  0.1708  0.6167  0.2066  0.2115  0.2946  0.3151  0.3829  ±0.49%     2421  
   · obj attr  44,651.48  0.0185  1.0262  0.0224  0.0237  0.0359  0.0432  0.0667  ±0.45%    22326   fastest


 BENCH  Summary

  obj attr - src/tests/map.pref.bench.ts > link with map or obj attr
    9.22x faster than map
    9.41x faster than weakmap
*/

