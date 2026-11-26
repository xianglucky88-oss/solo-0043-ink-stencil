import { deflateSync, inflateSync } from 'node:zlib';

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

function encodePng(width,height,pixels,bitDepth) {
  const header=Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height,4);
  header[8]=bitDepth; header[9]=6;
  const channels=4, bytesPerPixel=channels*(bitDepth/8);
  const stride=width*bytesPerPixel, raw=Buffer.alloc(height*(stride+1));
  for(let y=0;y<height;y++) pixels.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

export function png(width,height,pixels) {
  return encodePng(width,height,pixels,8);
}

// Minimal decoder for the PNGs this product exchanges: 8-bit or 16-bit,
// color type 6 (RGBA), a single IDAT stream, filters 0-4. Returns straight
// RGBA values downscaled to 8-bit bytes.
export function decodePng(buffer) {
  let offset=8;
  let width=0,height=0,bitDepth=0,colorType=0;
  const blocks=[];
  while(offset+8<=buffer.length) {
    const length=buffer.readUInt32BE(offset), type=buffer.toString('ascii',offset+4,offset+8);
    const body=buffer.subarray(offset+8,offset+8+length);
    if(type==='IHDR') {
      width=body.readUInt32BE(0); height=body.readUInt32BE(4);
      bitDepth=body[8]; colorType=body[9];
    } else if(type==='IDAT') blocks.push(body);
    else if(type==='IEND') break;
    offset+=12+length;
  }
  if(!width||!height||colorType!==6||(bitDepth!==8&&bitDepth!==16)) throw new Error('仅支持 8/16 位 RGBA PNG 底图');
  const inflated=inflateSync(Buffer.concat(blocks));
  const bytesPerPixel=4*(bitDepth/8), stride=width*bytesPerPixel;
  const filtered=Buffer.alloc(height*(stride+1));
  inflated.copy(filtered);
  const raw=Buffer.alloc(height*stride);
  const paeth=(a,b,c)=>{
    const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c);
    return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
  };
  for(let y=0;y<height;y++) {
    const filter=filtered[y*(stride+1)];
    const row=filtered.subarray(y*(stride+1)+1,(y+1)*(stride+1));
    const target=raw.subarray(y*stride,(y+1)*stride);
    row.copy(target);
    for(let x=0;x<stride;x++) {
      const a=x>=bytesPerPixel?target[x-bytesPerPixel]:0;
      const b=y>0?raw[(y-1)*stride+x]:0;
      const c=y>0&&x>=bytesPerPixel?raw[(y-1)*stride+x-bytesPerPixel]:0;
      if(filter===1) target[x]=(target[x]+a)&255;
      else if(filter===2) target[x]=(target[x]+b)&255;
      else if(filter===3) target[x]=(target[x]+((a+b)>>1))&255;
      else if(filter===4) target[x]=(target[x]+paeth(a,b,c))&255;
    }
  }
  const out=Buffer.alloc(width*height*4);
  for(let i=0;i<width*height*4;i++) {
    if(bitDepth===8) out[i]=raw[i*1];
    else out[i]=raw.readUInt16BE(i*2)>>8;
  }
  return {width,height,pixels:out};
}
