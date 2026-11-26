import { raster } from './raster.mjs';
import { png } from './png.mjs';
export { metadata } from './config.mjs';
export { normalize } from './document.mjs';
export { demo, revealDemo } from './demo.mjs';
export * from './animation.mjs';
export * from './apng.mjs';

export function render(document) {
  const { id,width,height,samples }=document;
  const {pixels,painted,partial,layers}=raster(document);
  return { bytes:png(width,height,pixels), summary:{id,width,height,samples,painted,partial,layers} };
}
