import { PNG_SIGNATURE, chunk, deflateRows } from './png-codec.mjs';

export function png(width,height,pixels) {
  const header=Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height,4);
  header[8]=8; header[9]=6;
  const stride=width*4, raw=Buffer.alloc(height*(stride+1));
  for(let y=0;y<height;y++) pixels.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride);
  return Buffer.concat([PNG_SIGNATURE,chunk('IHDR',header),deflateRows(raw),chunk('IEND',Buffer.alloc(0))]);
}
