import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDocuments } from '../product/merge.mjs';
import { normalize } from '../product/document.mjs';
import { raster } from '../product/raster.mjs';

function layer(id, options = {}) {
  return {
    id,
    shape: { kind: 'rect', w: 20, h: 20, radius: 0 },
    transform: { x: 50, y: 50, rotation: 0, sx: 1, sy: 1 },
    color: '#ff0000',
    opacity: 1,
    blend: 'normal',
    mask: null,
    visible: true,
    ...options,
  };
}

function fixture() {
  return {
    target: { id: 'target', width: 100, height: 100, samples: 1, layers: [layer('same')] },
    source: {
      id: 'source', width: 100, height: 100, samples: 2,
      layers: [
        layer('shared'),
        layer('masked', { mask: 'shared' }),
        layer('same', { mask: 'masked' }),
        layer('mark', { mask: 'same' }),
      ],
    },
    rects: { sourceRect: { x: 0, y: 0, w: 100, h: 100 }, targetRect: { x: 0, y: 0, w: 50, h: 100 } },
  };
}

test('appends selected marks with transitive masks once and hides unselected dependencies', () => {
  const { target, source, rects } = fixture();
  const result = mergeDocuments(target, source, { ids: ['mark'], ...rects });
  assert.equal(result, target);
  assert.deepEqual(result.layers.map(l => l.id), ['same', 'shared', 'masked', 'same-2', 'mark']);
  assert.equal(result.layers.at(-1).mask, 'same-2');
  assert.equal(result.layers.find(l => l.id === 'same-2').mask, 'masked');
  assert.equal(result.layers.find(l => l.id === 'masked').mask, 'shared');
  assert.equal(result.layers.filter(l => l.id === 'shared').length, 1);
  assert.equal(result.layers.find(l => l.id === 'shared').visible, false);
  assert.equal(result.layers.find(l => l.id === 'masked').visible, false);
  assert.equal(result.layers.find(l => l.id === 'same-2').visible, false);
  assert.equal(result.layers.at(-1).visible, true);
  // The target layer keeps its identity and unrewritten mask relation.
  assert.equal(result.layers[0].id, 'same');
  assert.equal(result.layers[0].mask, null);
});

test('retains target sampling and renders a true skew after nonuniform alignment', () => {
  const { target, source, rects } = fixture();
  source.layers = [layer('rotated', {
    shape: { kind: 'rect', w: 40, h: 10, radius: 0 },
    transform: { x: 50, y: 50, rotation: 45, sx: 1, sy: 1 },
  })];
  const merged = mergeDocuments(target, source, { ids: ['rotated'], ...rects });
  assert.equal(merged.samples, 1);
  const document = normalize({ ...merged, layers: merged.layers.filter(l => l.id === 'rotated') });
  const [a, b, c, d] = document.layers[0].transform.affine;
  assert.notEqual(a * b + c * d, 0);
  const { pixels } = raster(document);
  assert.equal(pixels[(50 * 100 + 25) * 4 + 3], 255);
});

test('budget overflow is atomic', () => {
  const { source, rects } = fixture();
  const target = {
    width: 512, height: 512, samples: 2,
    layers: Array.from({ length: 16 }, (_, i) => layer(`budget-${i}`)),
  };
  assert.throws(() => mergeDocuments(target, source, { ids: ['mark'], ...rects }), /层|预算/);
  assert.equal(target.layers.length, 16);
  assert.equal(target.layers.some(l => l.id === 'mark'), false);
});
