export const cubePrimitives = {
  position: [
    1, 1, 1, 1, 1, -1, 1, -1, 1, 1, -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, -1, -1, -1, 1, -1, 1, -1,
    1, 1, -1, -1, 1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, -1, -1, 1, -1, -1, -1, 1, 1, 1, 1, 1, -1,
    -1, 1, 1, -1, 1, 1, 1, -1, -1, 1, -1, 1, -1, -1, -1, -1, -1,
  ].map((v, k) => {
    if ((k + 1) % 3 === 0 && v === -1) {
      return 0;
    }
    return v;
  }),
  indices: [
    0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5, 8, 10, 9, 10, 11, 9, 12, 14, 13, 14, 15, 13, 16, 18, 17, 18,
    19, 17, 20, 22, 21, 22, 23, 21,
  ],
};