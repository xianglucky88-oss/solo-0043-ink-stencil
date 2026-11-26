import { choice, number, object, requireThat } from '../server/input.mjs';
import { inverse } from './transform.mjs';
import { channels } from './color.mjs';
import { sampleCoverage } from './masks.mjs';
import { over } from './blend.mjs';
import { png } from './png.mjs';
import { digest } from '../server/canonical.mjs';

// 单片最长边上限（输出像素）。
export const TILE_LIMIT = 512;
// 与单次校样相同的渲染预算：整幅输出像素 × 子样点 × 图层。
const RENDER_BUDGET = 8_000_000;
const COORD_MIN = -4096, COORD_MAX = 4096;
const SIDE_MAX = 1024, BLEED_MAX = 512;

// 规范化分幅请求：成品框与出血都是整数设计像素，倍率只能是 1 或 2。
// 预算按整幅输出核算，切分发生在预算校验之后，无法靠小片绕过。
export function normalizeKitRequest(input, document) {
  object(input, '分幅请求');
  const trim = object(input.trim, '成品框');
  const x = number(trim.x, COORD_MIN, COORD_MAX, '成品框 X', true);
  const y = number(trim.y, COORD_MIN, COORD_MAX, '成品框 Y', true);
  const w = number(trim.w, 1, SIDE_MAX, '成品框宽', true);
  const h = number(trim.h, 1, SIDE_MAX, '成品框高', true);
  const bleed = number(input.bleed, 0, BLEED_MAX, '出血', true);
  const scale = choice(input.scale, [1, 2], '输出倍率');
  const width = (w + 2 * bleed) * scale;
  const height = (h + 2 * bleed) * scale;
  const cost = width * height * document.samples * document.samples * document.layers.length;
  requireThat(cost <= RENDER_BUDGET, '分幅输出超出单次校样渲染预算');
  return { trim: { x, y, w, h }, bleed, scale, width, height };
}

// 规则网格切分：所有片等步长、边沿落在全局整数像素上，末片收短。
// 结果精确铺满整幅输出，无缺口、无重叠，每片最长边不超过 TILE_LIMIT。
export function planTiles(width, height, cap = TILE_LIMIT) {
  const columns = Math.ceil(width / cap);
  const rows = Math.ceil(height / cap);
  const stepX = Math.ceil(width / columns);
  const stepY = Math.ceil(height / rows);
  const tiles = [];
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < columns; tx++) {
    const x = tx * stepX, y = ty * stepY;
    tiles.push({
      index: tiles.length, x, y,
      width: Math.min(stepX, width - x),
      height: Math.min(stepY, height - y),
    });
  }
  return tiles;
}

function prepareLayers(document) {
  return document.layers.map(layer => ({
    ...layer,
    rgba: channels(layer.color),
    toLocal: inverse(layer.transform),
    maskIndex: document.layers.findIndex(row => row.id === layer.mask),
  }));
}

// 渲染整幅输出中的任意矩形区域。tile 的 x/y 是整幅输出像素坐标，
// 因此同一全局像素无论落在哪一片都取同一组子样点，跨片斜边不会错位。
export function renderPixels(layers, samples, request, tile) {
  const { scale, trim, bleed } = request;
  const originX = trim.x - bleed;
  const originY = trim.y - bleed;
  const sub = scale * samples;
  const pixels = Buffer.alloc(tile.width * tile.height * 4);
  const covered = new Uint8Array(layers.length);
  const pixel = new Float64Array(4), sum = new Float64Array(4);
  for (let ly = 0; ly < tile.height; ly++) for (let lx = 0; lx < tile.width; lx++) {
    const ox = tile.x + lx, oy = tile.y + ly;
    sum.fill(0);
    for (let sy = 0; sy < sub; sy++) for (let sx = 0; sx < sub; sx++) {
      // 输出像素先映射回设计坐标，再在该设计像素内取网格子样点；
      // 两倍件直接在原生分辨率栅格化，不是一倍图的放大。
      const dx = originX + (ox + (sx + 0.5) / samples) / scale;
      const dy = originY + (oy + (sy + 0.5) / samples) / scale;
      sampleCoverage(layers, dx, dy, covered);
      pixel.fill(0);
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const alpha = layer.opacity * layer.rgba[3];
        if (!covered[i] || !layer.visible || !alpha) continue;
        over(pixel, layer.rgba, alpha, layer.blend);
      }
      for (let i = 0; i < 4; i++) sum[i] += pixel[i];
    }
    const dest = (ly * tile.width + lx) * 4;
    const count = sub * sub;
    const alpha = pixels[dest + 3] = Math.round(255 * sum[3] / count);
    // 完全透明像素保持零字节，旧画布外真正没有内容的区域即为透明。
    if (alpha) for (let i = 0; i < 3; i++) pixels[dest + i] = Math.round(255 * sum[i] / sum[3]);
  }
  return pixels;
}

// 一次性产出整幅套件：成品框位置、各片坐标与实际尺寸、PNG 字节与摘要。
export function buildTileKit(document, request) {
  const normalized = normalizeKitRequest(request, document);
  const { width, height } = normalized;
  // 图层只准备一次，所有分片共享同一套几何与色彩管线。
  const layers = prepareLayers(document);
  const tiles = planTiles(width, height).map(tile => {
    const bytes = png(tile.width, tile.height, renderPixels(layers, document.samples, normalized, tile));
    return {
      ...tile,
      file: `tile-${String(tile.index).padStart(2, '0')}.png`,
      bytes,
      digest: digest(bytes),
    };
  });
  const manifest = {
    size: { width, height },
    scale: normalized.scale,
    trim: normalized.trim,
    bleed: normalized.bleed,
    // 成品框在整幅输出像素网格中的位置。
    frame: {
      x: normalized.bleed * normalized.scale,
      y: normalized.bleed * normalized.scale,
      w: normalized.trim.w * normalized.scale,
      h: normalized.trim.h * normalized.scale,
    },
    tiles: tiles.map(({ index, x, y, width: w, height: h, file, digest: hash }) =>
      ({ index, x, y, width: w, height: h, file, digest: hash })),
  };
  return { manifest, tiles };
}
