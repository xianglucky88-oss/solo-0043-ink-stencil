import { raster } from './raster.mjs';
import { tileRaster } from './tile.mjs';
import { png } from './png.mjs';
export { metadata } from './config.mjs';
export { normalize } from './document.mjs';
export { demo } from './demo.mjs';
export { tileRaster } from './tile.mjs';
export * from './area-proof.mjs';
export { tileProofPNG } from './tile-proof.mjs';
export { decodePNG } from './png-decode.mjs';

export function render(document) {
  const { id,width,height,samples }=document;
  const {pixels,painted,partial,layers}=raster(document);
  return { bytes:png(width,height,pixels), summary:{id,width,height,samples,painted,partial,layers} };
}

export function renderTile(document) {
  const { id,width,height,samples }=document;
  const {pixels,painted,partial,layers}=tileRaster(document);
  return { bytes:png(width,height,pixels), summary:{id,width,height,samples,painted,partial,layers,period:{width,height},variant:'tile'} };
}

export const renderRepeat = renderTile;
export const renderPattern = renderTile;
export const renderWallpaper = renderTile;
