import { deflateSync } from 'node:zlib';

const table=Array.from({length:256},(_,n)=>{
  for(let i=0;i<8;i++) n=(n>>>1)^((n&1)?0xedb88320:0);
  return n>>>0;
});

function chunk(tag, body) {
  const block=Buffer.alloc(12+body.length);
  block.writeUInt32BE(body.length);
  block.write(tag,4,'ascii');
  body.copy(block,8);
  let crc=0xffffffff;
  for(let i=4;i<8+body.length;i++) crc=(crc>>>8)^table[(crc^block[i])&0xff];
  block.writeUInt32BE((crc^0xffffffff)>>>0,8+body.length);
  return block;
}

export function png(width,height,pixels) {
  const header=Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height,4);
  header[8]=8; header[9]=6;
  const stride=width*4, raw=Buffer.alloc(height*(stride+1));
  for(let y=0;y<height;y++) pixels.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

// Reading/validation lives in png-read.mjs; re-exported here because PNG I/O
// is the natural module consumers import from.
export { decodePng, readPng, readChunks, evaluateColorSpace } from './png-read.mjs';
