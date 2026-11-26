import { deflateSync, inflateSync } from 'node:zlib';
import { InputError } from '../server/input.mjs';

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

// Eight-bit non-interlaced grayscale PNG (IHDR color type 0). `gray` is one
// byte per pixel, 0 = no ink, 255 = full ink. No alpha channel is written.
export function grayPng(width,height,gray) {
  const header=Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height,4);
  header[8]=8; header[9]=0;
  const stride=width, raw=Buffer.alloc(height*(stride+1));
  for(let y=0;y<height;y++) gray.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

export const pngGray=grayPng;
export const grayscalePng=grayPng;

const PNG_SIGNATURE=Buffer.from('89504e470d0a1a0a','hex');

function paeth(a,b,c) {
  const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c);
  return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
}

// Decodes the PNG flavors exchanged by the workbench: non-interlaced images,
// bit depths 1/2/4/8/16, color types 0/2/3/4/6 plus palette expansion.
// Returns 8-bit grayscale (`gray`) and straight RGBA (`pixels`) views.
export function decodePng(buffer) {
  if(!Buffer.isBuffer(buffer)) buffer=Buffer.from(buffer);
  if(buffer.length<24 || !buffer.subarray(0,8).equals(PNG_SIGNATURE)) {
    throw new InputError('文件不是有效的 PNG 图像',422);
  }
  let offset=8;
  let width=0,height=0,bitDepth=0,colorType=0,interlace=0;
  let palette=null, transparency=null;
  const blocks=[];
  while(offset+8<=buffer.length) {
    const length=buffer.readUInt32BE(offset);
    if(offset+12+length>buffer.length) throw new InputError('PNG 数据块已损坏',422);
    const type=buffer.toString('ascii',offset+4,offset+8);
    const body=buffer.subarray(offset+8,offset+8+length);
    if(type==='IHDR') {
      width=body.readUInt32BE(0); height=body.readUInt32BE(4);
      bitDepth=body[8]; colorType=body[9];
      // body[10] compression, body[11] filter are fixed by the PNG spec.
      interlace=body[12];
    } else if(type==='PLTE') {
      palette=body;
    } else if(type==='tRNS') {
      transparency=body;
    } else if(type==='IDAT') blocks.push(body);
    else if(type==='IEND') break;
    offset+=12+length;
  }
  if(!width||!height) throw new InputError('PNG 缺少画布尺寸',422);
  if(interlace!==0) throw new InputError('版文件须为非隔行 PNG',422);
  const allowedDepth={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[colorType];
  if(!allowedDepth || !allowedDepth.includes(bitDepth)) {
    throw new InputError('PNG 颜色类型或位深不受支持',422);
  }
  let inflated;
  try { inflated=inflateSync(Buffer.concat(blocks)); }
  catch { throw new InputError('PNG 压缩数据无法解码',422); }

  const channels={0:1,2:3,3:1,4:2,6:4}[colorType];
  const bitPerPixel=channels*bitDepth;
  const bytesPerPixel=Math.max(1,Math.ceil(bitPerPixel/8));
  const stride=Math.ceil(width*bitPerPixel/8);
  const filtered=inflated;
  const raw=Buffer.alloc(height*stride);
  for(let y=0;y<height;y++) {
    const rowStart=y*(stride+1);
    if(rowStart>=filtered.length) throw new InputError('PNG 扫描行不完整',422);
    const filter=filtered[rowStart];
    const target=raw.subarray(y*stride,(y+1)*stride);
    filtered.copy(target,0,rowStart+1,rowStart+1+stride);
    for(let x=0;x<stride;x++) {
      const a=x>=bytesPerPixel?target[x-bytesPerPixel]:0;
      const b=y>0?raw[(y-1)*stride+x]:0;
      const c=y>0&&x>=bytesPerPixel?raw[(y-1)*stride+x-bytesPerPixel]:0;
      if(filter===1) target[x]=(target[x]+a)&255;
      else if(filter===2) target[x]=(target[x]+b)&255;
      else if(filter===3) target[x]=(target[x]+((a+b)>>1))&255;
      else if(filter===4) target[x]=(target[x]+paeth(a,b,c))&255;
      else if(filter!==0) throw new InputError('PNG 行过滤器不受支持',422);
    }
  }

  // Expand sub-byte samples into one byte per sample index.
  const sampleCount=width*height*channels;
  const samples=new Uint16Array(sampleCount);
  if(bitDepth===16) {
    for(let i=0;i<sampleCount;i++) samples[i]=raw.readUInt16BE(i*2);
  } else if(bitDepth===8) {
    for(let i=0;i<sampleCount;i++) samples[i]=raw[i];
  } else {
    const mask=(1<<bitDepth)-1;
    let n=0;
    for(let p=0;p<width*height;p++) for(let c=0;c<channels;c++) {
      const bitIndex=(p*channels+c)*bitDepth;
      const byteIndex=bitIndex>>3, high=8-bitDepth-(bitIndex&7);
      samples[n++]=(raw[byteIndex]>>high)&mask;
    }
  }
  const maxSample=(1<<bitDepth)-1;
  const scale8=v=>bitDepth===8?v:bitDepth===16?(v>>8):Math.round(v*255/maxSample);

  const pixels=Buffer.alloc(width*height*4);
  const gray=Buffer.alloc(width*height);
  for(let p=0;p<width*height;p++) {
    let r=0,g=0,b=0,a=255;
    if(colorType===0) {
      r=g=b=scale8(samples[p]);
      if(colorType===0 && transparency && transparency.length>=2) {
        const key=transparency.readUInt16BE(0);
        if(samples[p]===key) a=0;
      }
    } else if(colorType===2) {
      r=scale8(samples[p*3]); g=scale8(samples[p*3+1]); b=scale8(samples[p*3+2]);
      if(transparency && transparency.length>=6) {
        if(samples[p*3]===transparency.readUInt16BE(0)
          && samples[p*3+1]===transparency.readUInt16BE(2)
          && samples[p*3+2]===transparency.readUInt16BE(4)) a=0;
      }
    } else if(colorType===3) {
      const index=samples[p];
      if(!palette || index*3+2>=palette.length) throw new InputError('PNG 调色板缺失',422);
      r=palette[index*3]; g=palette[index*3+1]; b=palette[index*3+2];
      if(transparency && index<transparency.length) a=transparency[index];
    } else if(colorType===4) {
      g=scale8(samples[p*2]); r=b=g; a=scale8(samples[p*2+1]);
    } else {
      r=scale8(samples[p*4]); g=scale8(samples[p*4+1]); b=scale8(samples[p*4+2]); a=scale8(samples[p*4+3]);
    }
    const o=p*4;
    pixels[o]=r; pixels[o+1]=g; pixels[o+2]=b; pixels[o+3]=a;
    // Grayscale amount ignores alpha: plate bytes carry no alpha by spec.
    gray[p]=colorType===0||colorType===4 ? g : Math.round(0.2126*r+0.7152*g+0.0722*b);
  }
  return {width,height,bitDepth,colorType,interlace,gray,pixels};
}

// Strict reader for the two hand-held printer plates: non-interlaced 8-bit
// grayscale PNG only. Dimensions are returned for the equality check.
export function readPlatePng(buffer) {
  const plate=decodePng(buffer);
  if(plate.bitDepth!==8 || plate.colorType!==0) {
    throw new InputError('版文件规格不符：须为不带透明度的非隔行八位灰度 PNG',422);
  }
  return {width:plate.width,height:plate.height,gray:plate.gray};
}

export const decodePlate=readPlatePng;
