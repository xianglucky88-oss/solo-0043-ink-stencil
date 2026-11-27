import { PNG_SIGNATURE, chunk, textChunk, deflateRows } from './png-codec.mjs';

export const OUTLINE_META_KEY='ink-outline';
export const OUTLINE_MIME='image/png';
export const OUTLINE_SUFFIX='outline.png';

export function outlineMetadata(outline) {
  return {
    version:1,
    width:outline.width,
    height:outline.height,
    gridWidth:outline.gridWidth,
    gridHeight:outline.gridHeight,
    paddingPixels:outline.paddingPixels,
    cellsPerPixel:outline.cellsPerPixel,
    clipDistance:outline.clipDistance,
    empty:outline.empty,
  };
}

// 单通道灰度 PNG：像素字节即量化后的带符号距离，参数放在 tEXt 块中，单文件即可离线使用。
export function outlinePng(outline) {
  const { gridWidth:w, gridHeight:h, bytes }=outline;
  const header=Buffer.alloc(13);
  header.writeUInt32BE(w);
  header.writeUInt32BE(h,4);
  header[8]=8;   // 8 bit
  header[9]=0;   // grayscale
  header[10]=0; header[11]=0; header[12]=0;
  const raw=Buffer.alloc(h*(w+1));
  for(let y=0;y<h;y++) raw.set(bytes.subarray(y*w,(y+1)*w),y*(w+1)+1);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR',header),
    textChunk(OUTLINE_META_KEY, JSON.stringify(outlineMetadata(outline))),
    deflateRows(raw),
    chunk('IEND',Buffer.alloc(0)),
  ]);
}

// 浏览器与 Node 通用：只解析块结构，像素由宿主 PNG 解码器读取。
export function readPngChunks(buffer) {
  const bytes=new Uint8Array(buffer);
  const chunks=[];
  let offset=8;
  while(offset+8<=bytes.length) {
    const length=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0);
    const type=String.fromCharCode(bytes[offset+4],bytes[offset+5],bytes[offset+6],bytes[offset+7]);
    const start=offset+8;
    chunks.push({ type, data:bytes.subarray(start,start+length) });
    offset=start+length+4;
    if(type==='IEND') break;
  }
  return chunks;
}

export function parseOutlineMeta(chunks) {
  const text=chunks.find(item=>item.type==='tEXt');
  if(!text) throw new Error('轮廓素材缺少参数块');
  let nul=0; while(text.data[nul]!==0) nul++;
  const keyword=String.fromCharCode(...text.data.subarray(0,nul));
  if(keyword!==OUTLINE_META_KEY) throw new Error('轮廓素材参数块不匹配');
  return JSON.parse(new TextDecoder('utf-8').decode(text.data.subarray(nul+1)));
}
