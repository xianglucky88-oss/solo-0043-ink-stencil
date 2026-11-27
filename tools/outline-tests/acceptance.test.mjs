import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { buildOutline, decodeValue, CELLS_PER_PIXEL, PADDING_CELLS } from '../../product/outline.mjs';
import { outlinePng, readPngChunks, parseOutlineMeta } from '../../product/outline-png.mjs';
import { renderOutline, loadOutline, outputSize } from '../../web/sdf-render.mjs';

function decodeGray(buffer) {
  const chunks=readPngChunks(buffer);
  const ihdr=chunks.find(c=>c.type==='IHDR');
  const view=new DataView(ihdr.data.buffer,ihdr.data.byteOffset,ihdr.data.byteLength);
  const w=view.getUint32(0), h=view.getUint32(4);
  const raw=inflateSync(Buffer.concat(chunks.filter(c=>c.type==='IDAT').map(c=>Buffer.from(c.data))));
  const gray=new Uint8Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) gray[y*w+x]=raw[y*(w+1)+1+x];
  return gray;
}
const L=(id,kind,w,h,x,y,color,op={})=>({id,shape:{kind,w,h,radius:op.radius??0},transform:{x,y,rotation:op.rotation??0,sx:op.sx??1,sy:op.sy??1},color,opacity:op.opacity??1,blend:op.blend??'normal',mask:op.mask??null,visible:op.visible??true});

// 验收素材：带孔环（四块矩形），另加一道被隐藏遮罩裁在半像素处的直边。
const acceptanceDoc={ id:'accept', width:40, height:32, samples:2, layers:[
  // 半像素裁边：隐藏遮罩右边落在设计 x=18.5（宽 9、中心 14 -> 9.5..18.5）。
  L('clip','rect',9,32,14,16,'#ff00ff',{visible:false}),
  L('ink','rect',20,32,14,16,'#21434d',{mask:'clip'}),
  // 在墨块右侧拼出带孔结构，整体仍被同一前序几何约束之外的独立形状承载。
  L('ring-top','rect',10,4,29,22,'#f6a778'),
  L('ring-bottom','rect',10,4,29,30,'#f6a778'),
  L('ring-left','rect',3,4,25.5,26,'#f6a778'),
  L('ring-right','rect',3,4,32.5,26,'#f6a778'),
]};

const outline=buildOutline(acceptanceDoc);
const bytes=outlinePng(outline);
const { meta,grid }=await loadOutline(bytes,decodeGray);

// 1. 同一份素材换颜色：红填蓝边 vs 绿填黄边，形状覆盖（alpha 通道）完全一致。
{
  const a=renderOutline(grid,meta,{fillColor:'#ff0000',strokeColor:'#0000ff',strokeWidth:2,scale:2});
  const b=renderOutline(grid,meta,{fillColor:'#00ff00',strokeColor:'#ffff00',strokeWidth:2,scale:2});
  assert.equal(a.width,b.width); assert.equal(a.height,b.height);
  let diffs=0;
  for(let i=0;i<a.pixels.length;i+=4) {
    assert.equal(a.pixels[i+3],b.pixels[i+3],'alpha must be identical under recolor');
    if(a.pixels[i]!==b.pixels[i] || a.pixels[i+1]!==b.pixels[i+1] || a.pixels[i+2]!==b.pixels[i+2]) diffs++;
  }
  assert.ok(diffs>0,'colors must actually differ');
  console.log('1. recolor preserves alpha coverage across',a.pixels.length/4,'pixels');
}

// 2. 同一份素材换倍率 1..4：输出宽高随等比缩放并向上取整；几何覆盖以 SDF 零点面积为准。
{
  // 素材层面的填充格数（d>=0 的小格数）是几何真值，与倍率无关。
  const filledCells=grid.reduce((n,b)=>n+(decodeValue(b)>=0?1:0),0);
  for(const scale of [1,2,3,4]) {
    const rendered=renderOutline(grid,meta,{fillColor:'#ffffff',strokeWidth:0,scale});
    const expected=outputSize(meta,scale);
    assert.deepEqual({width:rendered.width,height:rendered.height},expected);
    assert.equal(rendered.width,Math.ceil((meta.width+meta.paddingPixels*2)*scale));
    assert.equal(rendered.height,Math.ceil((meta.height+meta.paddingPixels*2)*scale));
    // 完全落在填充外的角落实透明。
    assert.equal(rendered.pixels[3],0);
  }
  assert.ok(filledCells>0);
  console.log('2. scales 1..4 produce ceil-sized outputs; filled cells =',filledCells);
}

// 3. 同一份素材换描边宽度 0..3：宽度越大有墨面积越大；0 时仅填充。
{
  const areas=[];
  for(const w of [0,1,2,3]) {
    const rendered=renderOutline(grid,meta,{fillColor:'#21434d',strokeColor:'#93d7ae',strokeWidth:w,scale:2});
    const ink=rendered.pixels.filter((_,i)=>i%4===3 && rendered.pixels[i]>0).length;
    areas.push(ink);
  }
  for(let k=1;k<4;k++) assert.ok(areas[k]>areas[k-1],`w=${k} must cover more than w=${k-1}`);
  console.log('3. stroke widths 0..3 monotonically expand coverage:',areas.join(' < '));
}

// 4. 半像素遮罩直边：隐藏遮罩右边 x=18.5，轮廓边界必须落在该格线上。
{
  const rowGy=16*CELLS_PER_PIXEL+PADDING_CELLS;
  let last=-1;
  for(let gx=0;gx<outline.gridWidth;gx++) if(outline.cells[rowGy*outline.gridWidth+gx]) last=gx;
  const edge=(last+1-PADDING_CELLS)/CELLS_PER_PIXEL;
  assert.ok(Math.abs(edge-18.5)<1e-9,`mask edge at ${edge}, want 18.5`);
  // 边界两侧格心距离 ±0.25，符号内正外负。
  assert.ok(Math.abs(outline.distances[rowGy*outline.gridWidth+last]-0.25)<1e-9);
  assert.ok(Math.abs(outline.distances[rowGy*outline.gridWidth+last+1]+0.25)<1e-9);
  console.log('4. hidden mask clips a straight edge exactly at half-pixel x=18.5');
}

// 5. 孔心透明、孔沿可被描边覆盖；窄孔在宽描边下允许失去透明孔心。
{
  // 环孔设计范围 x 27..31、y 24..28，孔心 (29,26)。
  const narrow=renderOutline(grid,meta,{fillColor:'#21434d',strokeColor:'#93d7ae',strokeWidth:1,scale:2});
  const hx=Math.round((29+4)*2), hy=Math.round((26+4)*2);
  assert.ok(narrow.pixels[(hy*narrow.width+hx)*4+3]<64,'hole center remains clear at w=1');
  // w=3 时孔沿被外扩描边覆盖，孔心 alpha 允许上升（不强制保留孔心）。
  const wide=renderOutline(grid,meta,{fillColor:'#21434d',strokeColor:'#93d7ae',strokeWidth:3,scale:2});
  const wideEdge=wide.pixels[(hy*wide.width+Math.round((27.25+4)*2))*4+3];
  assert.ok(wideEdge>0,'stroke reaches the hole rim');
  console.log('5. hole center clear at narrow stroke, rim covered at wide stroke');
}

// 6. 素材元数据完整，留边与原稿坐标对位。
{
  const chunks=readPngChunks(bytes);
  const parsed=parseOutlineMeta(chunks);
  assert.equal(parsed.paddingPixels,4);
  assert.equal(parsed.cellsPerPixel,2);
  assert.equal(parsed.width,40); assert.equal(parsed.height,32);
  assert.equal(parsed.gridWidth,40*2+16);
  // 原稿左上角 (0,0) 的格心索引：格 (PADDING_CELLS, PADDING_CELLS)。
  const idx=PADDING_CELLS*parsed.gridWidth+PADDING_CELLS;
  assert.ok(decodeValue(grid[idx])<=-3.9,'outside-canvas padding reads near -4');
  console.log('6. metadata and original-coordinate registration OK');
}

console.log('All acceptance tests passed.');
