import { deflateSync, inflateSync } from 'node:zlib';
import { rasterPremultiplied } from './raster.mjs';
import { encodeMark, decodeMark, MARK_TYPE, MARK_SUFFIX } from './mark.mjs';

const MAX16 = 65535;
const backdrops = [
  { rgb: [0, 0, 0], alpha: 0 },   // transparent: plates[0] carries emblem coverage
  { rgb: [0, 0, 0], alpha: 1 },   // opaque black
  { rgb: [1, 1, 1], alpha: 1 },   // opaque white
];

function toPlate(premultiplied) {
  const plate = new Uint16Array(premultiplied.length);
  for (let i = 0; i < premultiplied.length; i++) {
    plate[i] = Math.round(Math.min(1, Math.max(0, premultiplied[i])) * MAX16);
  }
  return plate;
}

// Renders the three backdrop plates with the exact proof engine, then packs
// them. No geometry, shapes or transforms survive in the returned bytes.
export function exportMark(document) {
  const { width, height } = document;
  const plates = backdrops.map(backdrop => toPlate(rasterPremultiplied(document, backdrop).premultiplied));
  return encodeMark(width, height, plates, deflateSync);
}

// Reference proof: place an 8-bit straight-RGBA backdrop under the original
// artwork and run the very same engine with per-pixel backdrops. Subsamples
// of a pixel share the backdrop color and coverage. Returns straight 8-bit
// RGBA with zero RGB on fully transparent output pixels. This is the
// acceptance ground truth for the plate-based local composite.
export function directProof(document, backdrop) {
  const { width, height } = document;
  const { premultiplied } = rasterPremultiplied(document, backdrop);
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0, pixel = 0; pixel < width * height; pixel++, p += 4) {
    const alpha = Math.round(255 * Math.min(1, Math.max(0, premultiplied[p + 3])));
    if (alpha === 0) continue;
    out[p + 3] = alpha;
    for (let channel = 0; channel < 3; channel++) {
      const index = p + channel;
      const straight = Math.min(1, Math.max(0, premultiplied[index] / premultiplied[p + 3]));
      out[index] = Math.round(255 * straight);
    }
  }
  return out;
}

export async function readMark(bytes) {
  return decodeMark(bytes, body => inflateSync(body));
}

export { MARK_TYPE, MARK_SUFFIX };
