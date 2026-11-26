export * from '../web/tile-resample.mjs';
export { decodePNG } from './png-decode.mjs';
export { png } from './png.mjs';

import { resampleTile } from '../web/tile-resample.mjs';
import { png } from './png.mjs';

export function tileProofPNG(source, options = {}) {
  const result = resampleTile(source, options);
  return { ...result, bytes: png(result.width, result.height, Buffer.from(result.data)) };
}
