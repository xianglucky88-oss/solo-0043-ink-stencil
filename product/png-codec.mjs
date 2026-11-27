import { deflateSync } from 'node:zlib';

export const crcTable=Array.from({length:256},(_,n)=>{
  for(let i=0;i<8;i++) n=(n>>>1)^((n&1)?0xedb88320:0);
  return n>>>0;
});

export function chunk(tag, body) {
  const block=Buffer.alloc(12+body.length);
  block.writeUInt32BE(body.length);
  block.write(tag,4,'ascii');
  body.copy(block,8);
  let crc=0xffffffff;
  for(let i=4;i<8+body.length;i++) crc=(crc>>>8)^crcTable[(crc^block[i])&0xff];
  block.writeUInt32BE((crc^0xffffffff)>>>0,8+body.length);
  return block;
}

export function textChunk(keyword, text) {
  return chunk('tEXt', Buffer.from(`${keyword}\0${text}`,'latin1'));
}

export function deflateRows(raw) {
  return chunk('IDAT', deflateSync(raw));
}

export const PNG_SIGNATURE=Buffer.from('89504e470d0a1a0a','hex');
