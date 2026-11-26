import { raster } from './raster.mjs';
import { png } from './png.mjs';
export { metadata } from './config.mjs';
export { normalize } from './document.mjs';
export { demo } from './demo.mjs';

export function render(document) {
  const { id }=document;
  const { width,height,pixels,painted,partial,layers }=raster(document);
  const bytes=png(width,height,pixels);
  return { pixels, bytes, summary:{id,width,height,samples:document.samples,painted,partial,layers} };
}
