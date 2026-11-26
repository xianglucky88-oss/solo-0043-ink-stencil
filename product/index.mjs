import { raster } from './raster.mjs';
import { png } from './png.mjs';
import { renderPlates } from './plates.mjs';
export { metadata } from './config.mjs';
export { normalize } from './document.mjs';
export { demo } from './demo.mjs';
export {
  rasterPlates, renderPlates, makePlates, generatePlates, buildPlates,
  compositeProof, overprintProof, proofPlates, buildProof, proofFromBody,
  normalizePlateRef, normalizeOverprint, normalizeShift, normalizeInkColor,
  inkByte, roundInk, PLATE_IDS,
} from './plates.mjs';
export { grayPng, pngGray, grayscalePng, decodePng, readPlatePng, decodePlate } from './png.mjs';

export function render(document) {
  const { id,width,height,samples }=document;
  const {pixels,painted,partial,layers}=raster(document);
  const bytes=png(width,height,pixels);
  // Plate generation is additive: the color proof bytes/summary are untouched.
  const plates=renderPlates(document);
  return { bytes, plates, summary:{id,width,height,samples,painted,partial,layers} };
}
