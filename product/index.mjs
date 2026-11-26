import { raster } from './raster.mjs';
import { png } from './png.mjs';
import { exportMark } from './mark-export.mjs';
import { MARK_TYPE, MARK_SUFFIX } from './mark.mjs';
export { metadata } from './config.mjs';
export { normalize } from './document.mjs';
export { demo } from './demo.mjs';
export { exportMark, directProof, readMark } from './mark-export.mjs';
export { compositeMark, MARK_TYPE, MARK_SUFFIX } from './mark.mjs';
export { decodePng } from './png.mjs';

export function render(document) {
  const { id,width,height,samples }=document;
  const {pixels,painted,partial,layers}=raster(document);
  const proof=png(width,height,pixels);
  const mark=exportMark(document);
  return { bytes:proof, mark, summary:{id,width,height,samples,painted,partial,layers} };
}
