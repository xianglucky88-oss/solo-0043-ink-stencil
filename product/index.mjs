import { raster } from './raster.mjs';
import { png } from './png.mjs';
import { buildOutline } from './outline.mjs';
import { outlinePng, outlineMetadata, OUTLINE_MIME, OUTLINE_SUFFIX } from './outline-png.mjs';
export { metadata } from './config.mjs';
export { normalize } from './document.mjs';
export { demo } from './demo.mjs';

export function render(document) {
  const { id,width,height,samples }=document;
  const {pixels,painted,partial,layers}=raster(document);
  return { bytes:png(width,height,pixels), summary:{id,width,height,samples,painted,partial,layers} };
}

export function renderOutline(document) {
  const outline=buildOutline(document);
  return { bytes:outlinePng(outline), meta:outlineMetadata(outline) };
}

export { outlineMetadata, OUTLINE_MIME, OUTLINE_SUFFIX };
