import assert from 'node:assert/strict';
import { normalize, renderTile } from '../product/index.mjs';
import { decodePNG } from '../product/png-decode.mjs';
import { resampleTile } from '../product/area-proof.mjs';

const layer = (id, color, options = {}) => ({
  id,
  shape: { kind: 'rect', w: 20, h: 20, radius: 0 },
  transform: { x: 16, y: 16, rotation: 0, sx: 1, sy: 1 },
  color,
  opacity: 1,
  blend: 'normal',
  mask: null,
  visible: true,
  ...options,
});

const document = normalize({
  id: 'tile-check',
  width: 32,
  height: 32,
  samples: 1,
  layers: [
    layer('self', '#ff000080', { shape: { kind: 'rect', w: 48, h: 48 } }),
    layer('clip', '#ffffff', {
      shape: { kind: 'rect', w: 10, h: 32 },
      transform: { x: 0, y: 16 },
      visible: false,
    }),
    layer('edge', '#00ff00', {
      shape: { kind: 'rect', w: 8, h: 32 },
      transform: { x: 0, y: 16 },
      mask: 'clip',
    }),
    layer('cross-copy', '#ff00ff', {
      shape: { kind: 'rect', w: 6, h: 32 },
      transform: { x: 32, y: 16 },
      mask: 'clip',
    }),
    layer('outside', '#0000ff', {
      shape: { kind: 'rect', w: 10, h: 10 },
      transform: { x: -18, y: 16 },
    }),
  ],
});

const tile = decodePNG(renderTile(document).bytes);
const pixel = (x, y) => {
  x = ((x % tile.width) + tile.width) % tile.width;
  y = ((y % tile.height) + tile.height) % tile.height;
  const offset = (y * tile.width + x) * 4;
  return Array.from(tile.data.subarray(offset, offset + 4));
};

assert.deepEqual(pixel(20, 16), [255, 0, 0, 128]);
assert.equal(pixel(30, 16)[2], 0);
assert.ok(pixel(1, 16)[1] > 0);
assert.ok(pixel(31, 16)[1] > 0 || pixel(29, 16)[1] > 0);
assert.equal(pixel(14, 16)[2], 255);

const edge = {
  width: 2,
  height: 1,
  data: new Uint8ClampedArray([0, 0, 0, 0, 255, 32, 16, 255]),
};
const half = resampleTile(edge, { outputWidth: 1, outputHeight: 1, offsetX: -0.5, cell: 1 });
assert.equal(Math.abs(half.data[3] - 128) <= 1, true);
assert.equal(half.data[0] > 250, true);

const blank = resampleTile(
  { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) },
  { outputWidth: 7, outputHeight: 5, offsetX: -19.3, offsetY: 4.7, cell: 7.25 },
);
for (let i = 0; i < blank.data.length; i += 4) {
  assert.deepEqual(Array.from(blank.data.subarray(i, i + 4)), [0, 0, 0, 0]);
}

console.log('Tile export and area proof: OK');
