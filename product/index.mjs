import { raster } from './raster.mjs';
import { png } from './png.mjs';
export { metadata } from './config.mjs';
export { normalize } from './document.mjs';
export { demo } from './demo.mjs';
export { recoverFromPng, recoverDocument, tracePng, pngToDocument, importPng, recoverPng, recover, vectorize } from './recover.mjs';
export { decodePng, readPng, evaluateColorSpace, readChunks } from './png-read.mjs';
export { traceMask, traceComponent, labelComponents } from './trace.mjs';

export function render(document) {
  const { id,width,height,samples }=document;
  const {pixels,painted,partial,layers}=raster(document);
  return { bytes:png(width,height,pixels), summary:{id,width,height,samples,painted,partial,layers} };
}
