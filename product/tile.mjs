import { inverse } from './transform.mjs';
import { channels } from './color.mjs';
import { includes } from './shapes.mjs';
import { over } from './blend.mjs';

export * from '../web/tile-resample.mjs';

// Evaluate one complete layer-stack copy at an unwrapped pattern coordinate.
// The same period offset is used by the layer and every mask in its chain.
function chainAt(layers, index, x, y) {
  const layer = layers[index];
  const [u, v] = layer.toLocal(x, y);
  if (!includes(layer.shape, u, v)) return false;
  return layer.maskIndex === -1 || chainAt(layers, layer.maskIndex, x, y);
}

function periodRange(point, min, max, period) {
  // Deliberately widen the integer range. Shape tests are conservative enough
  // that the extra candidates are rejected, while floating-point boundary
  // rounding can never omit the only valid copy.
  const first = Math.floor((point - max) / period) - 1;
  const last = Math.ceil((point - min) / period) + 1;
  return [first, last];
}

function periodicCoverage(layers, x, y, width, height, covered) {
  covered.fill(0);
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const { minX, maxX, minY, maxY } = layer.chainReach;
    if (minX > maxX || minY > maxY) {
      covered[i] = 0;
      continue;
    }
    const [kx0, kx1] = periodRange(x, minX, maxX, width);
    const [ky0, ky1] = periodRange(y, minY, maxY, height);
    let hit = false;
    for (let ky = ky0; ky <= ky1 && !hit; ky++) {
      const qy = y - ky * height;
      for (let kx = kx0; kx <= kx1; kx++) {
        const qx = x - kx * width;
        if (chainAt(layers, i, qx, qy)) {
          hit = true;
          break;
        }
      }
    }
    // Boolean union: many period copies are still one layer contribution.
    covered[i] = hit ? 1 : 0;
  }
  return covered;
}

function transformedReach(layer) {
  const { w, h } = layer.shape;
  const { sx, sy } = layer.transform;
  const angle = layer.transform.rotation * Math.PI / 180;
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const halfW = w / 2;
  const halfH = h / 2;
  const reachX = c * sx * halfW + s * sy * halfH;
  const reachY = s * sx * halfW + c * sy * halfH;
  return {
    minX: layer.transform.x - reachX,
    maxX: layer.transform.x + reachX,
    minY: layer.transform.y - reachY,
    maxY: layer.transform.y + reachY,
  };
}

export function tileRaster(document) {
  const { width, height, samples } = document;
  const layers = document.layers.map((layer) => {
    const prepared = {
      ...layer,
      rgba: channels(layer.color),
      toLocal: inverse(layer.transform),
      maskIndex: document.layers.findIndex((row) => row.id === layer.mask),
      hits: 0,
    };
    prepared.reach = transformedReach(prepared);
    return prepared;
  });

  // Conservative intersection of this layer and its same-copy mask chain.
  // Using it for candidate offsets keeps huge strokes clipped by tiny masks
  // fast without ever testing a stroke copy against another copy's mask.
  for (const layer of layers) {
    let reach = { ...layer.reach };
    let maskIndex = layer.maskIndex;
    while (maskIndex !== -1) {
      const maskReach = layers[maskIndex].chainReach;
      reach = {
        minX: Math.max(reach.minX, maskReach.minX),
        maxX: Math.min(reach.maxX, maskReach.maxX),
        minY: Math.max(reach.minY, maskReach.minY),
        maxY: Math.min(reach.maxY, maskReach.maxY),
      };
      maskIndex = layers[maskIndex].maskIndex;
    }
    layer.chainReach = reach;
  }

  const pixels = Buffer.alloc(width * height * 4);
  const covered = new Uint8Array(layers.length);
  const pixel = new Float64Array(4);
  const sum = new Float64Array(4);
  let painted = 0;
  let partial = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      sum.fill(0);
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const sampleX = x + (sx + 0.5) / samples;
          const sampleY = y + (sy + 0.5) / samples;
          periodicCoverage(layers, sampleX, sampleY, width, height, covered);
          pixel.fill(0);
          for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            const alpha = layer.opacity * layer.rgba[3];
            if (!covered[i] || !layer.visible || !alpha) continue;
            layer.hits++;
            over(pixel, layer.rgba, alpha, layer.blend);
          }
          for (let i = 0; i < 4; i++) sum[i] += pixel[i];
        }
      }

      const dest = (y * width + x) * 4;
      const alpha = (pixels[dest + 3] = Math.round((255 * sum[3]) / (samples * samples)));
      if (alpha) {
        painted++;
        if (alpha < 255) partial++;
        for (let i = 0; i < 3; i++) {
          pixels[dest + i] = Math.round((255 * sum[i]) / sum[3]);
        }
      }
    }
  }

  return {
    pixels,
    painted,
    partial,
    layers: layers.map(({ id, visible, hits }) => ({ id, visible, hits })),
  };
}
