import { deflateSync } from 'node:zlib';

const table=Array.from({length:256},(_,n)=>{
  for(let i=0;i<8;i++) n=(n>>>1)^((n&1)?0xedb88320:0);
  return n>>>0;
});

export function pngChunk(tag, body) {
  const block=Buffer.alloc(12+body.length);
  block.writeUInt32BE(body.length);
  block.write(tag,4,'ascii');
  body.copy(block,8);
  let crc=0xffffffff;
  for(let i=4;i<8+body.length;i++) crc=(crc>>>8)^table[(crc^block[i])&0xff];
  block.writeUInt32BE((crc^0xffffffff)>>>0,8+body.length);
  return block;
}

// Backwards-compatible private name used inside this module.
const chunk=pngChunk;

// Prepends a filter-byte (0 = None) to every scanline. The returned buffer is
// the raw layout handed to zlib and shared by PNG and APNG frame encoding.
export function scanlineBytes(width,height,pixels) {
  const stride=width*4, raw=Buffer.alloc(height*(stride+1));
  for(let y=0;y<height;y++) pixels.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride);
  return raw;
}

export function png(width,height,pixels) {
  const header=Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height,4);
  header[8]=8; header[9]=6;
  const raw=scanlineBytes(width,height,pixels);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
