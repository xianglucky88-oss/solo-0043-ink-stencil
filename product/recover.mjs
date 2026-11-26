import { createHash } from 'node:crypto';
import { InputError, requireThat } from '../server/input.mjs';
import { readPng } from './png-read.mjs';
import { traceMask } from './trace.mjs';
import { normalize } from './document.mjs';

const MIN_SIZE = 16, MAX_SIZE = 64;

function asBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return Buffer.from(input);
  if (typeof input === 'string') {
    const trimmed = input.trim();
    const dataUrl = /^data:image\/png(?:;[^,]*)?,([\s\S]*)$/i.exec(trimmed);
    if (dataUrl) return Buffer.from(dataUrl[1], 'base64');
    if (/^[a-z0-9+/=\s]+$/i.test(trimmed)) return Buffer.from(trimmed, 'base64');
    if (/^[A-Za-z0-9_-]+$/.test(trimmed)) return Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    throw new InputError('PNG 数据不是有效的 base64 字符串', 422);
  }
  if (input && typeof input === 'object') {
    // Tolerate JSON envelopes used by scripts: {png|image|data|base64|file}
    for (const key of ['png', 'pngBase64', 'png_base64', 'image', 'imageBase64', 'data', 'base64', 'file', 'bytes']) {
      if (input[key] != null) return asBuffer(input[key]);
    }
    // Node's JSON representation of a Buffer: { type:'Buffer', data:[...] }
    if (input.type === 'Buffer' && Array.isArray(input.data)) return Buffer.from(input.data);
  }
  throw new InputError('没有收到 PNG 字节', 422);
}

const hex = n => n.toString(16).padStart(2, '0');

export function recoverFromPng(source) {
  const buffer = asBuffer(source);
  const decoded = readPng(buffer);
  const { width, height, rgba16 } = decoded;

  requireThat(Number.isInteger(width) && Number.isInteger(height) &&
    width >= MIN_SIZE && width <= MAX_SIZE && height >= MIN_SIZE && height <= MAX_SIZE,
  `只接收宽、高各为 ${MIN_SIZE}–${MAX_SIZE} 像素的 PNG；这张是 ${width} × ${height}`);

  // Validate alpha discipline and collect exact 8-bit opaque colors.
  const colorOrder = [];
  const colorSet = new Map(); // key rrggbb -> {r,g,b}
  let opaque = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const a = rgba16[i + 3];
    if (a === 0) continue; // RGB hidden under full transparency is intentionally ignored
    if (a !== 65535) {
      const x = p % width, y = (p / width) | 0;
      throw new InputError(`像素 (${x},${y}) 既非全透明也非全不透明；徽记恢复只接受硬边透明（alpha 为 0 或 255）`, 422);
    }
    const r16 = rgba16[i], g16 = rgba16[i + 1], b16 = rgba16[i + 2];
    if (r16 % 257 !== 0 || g16 % 257 !== 0 || b16 % 257 !== 0) {
      throw new InputError('存在无法用八位 RGB 精确表示的颜色（疑似 16 位通道取值）', 422);
    }
    const rgb = [r16 / 257, g16 / 257, b16 / 257];
    const key = rgb.map(hex).join('');
    if (!colorSet.has(key)) {
      colorSet.set(key, { rgb, key });
      colorOrder.push(key);
    }
    opaque++;
  }

  requireThat(colorOrder.length >= 1, '整张图没有任何不透明像素，无法恢复徽记');
  requireThat(colorOrder.length <= 2,
    `所有不透明像素合计只允许一到两种颜色；这张 PNG 用了 ${colorOrder.length} 种颜色`);

  const cx = width / 2, cy = height / 2;
  const layerInfos = [];
  const layers = colorOrder.map((key, colorIndex) => {
    const match = p => {
      const i = p * 4;
      return rgba16[i + 3] === 65535 &&
        rgba16[i] / 257 === colorSet.get(key).rgb[0] &&
        rgba16[i + 1] / 257 === colorSet.get(key).rgb[1] &&
        rgba16[i + 2] / 257 === colorSet.get(key).rgb[2];
    };
    const piecesGrid = traceMask(match, width, height);
    const pieces = piecesGrid.map((traced, pieceIndex) => {
      const toLocal = ring => ring.map(([x, y]) => [x - cx, y - cy]);
      const outer = toLocal(traced.outer);
      const holes = traced.holes.map(toLocal);
      const rings = [outer, ...holes];
      return {
        id: `piece-${colorIndex + 1}-${pieceIndex + 1}`,
        points: outer,
        holes,
        rings,
      };
    });
    const id = `color-${key}`;
    const holeCount = pieces.reduce((sum, piece) => sum + piece.holes.length, 0);
    layerInfos.push({ id, color: `#${key}`, pieces: pieces.length, holes: holeCount, pixels: piecesGrid.reduce((s, p) => s + p.cellCount, 0) });
    return {
      id,
      shape: { kind: 'contours', w: width, h: height, pieces },
      transform: { x: cx, y: cy, rotation: 0, sx: 1, sy: 1 },
      color: `#${key}`,
      opacity: 1,
      blend: 'normal',
      mask: null,
      visible: true,
    };
  });

  const pixelKey = createHash('sha256').update(Buffer.from(rgba16.buffer, rgba16.byteOffset, rgba16.byteLength)).digest('hex').slice(0, 12);
  const draft = {
    id: `recovered-${pixelKey}`,
    width,
    height,
    samples: 1,
    layers,
  };
  // Run the workbench's own normalizer so the returned draft is guaranteed
  // editable, freezable and renderable without the original PNG.
  const document = normalize(draft);
  return {
    document,
    info: {
      width, height, opaquePixels: opaque,
      colorSpace: decoded.colorSpace.state,
      colorClaims: decoded.colorSpace.claims,
      colors: colorOrder.map(key => `#${key}`),
      layers: layerInfos,
    },
  };
}

// Backwards/forgiving aliases used by some import surfaces.
export function recoverDocument(source) {
  return recoverFromPng(source).document;
}
export const tracePng = recoverFromPng;
export const pngToDocument = recoverDocument;
export const importPng = recoverFromPng;
export const recoverPng = recoverFromPng;
export const recover = recoverFromPng;
export const vectorize = recoverFromPng;
