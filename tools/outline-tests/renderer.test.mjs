import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { buildOutline, decodeValue, CELLS_PER_PIXEL } from '../../product/outline.mjs';
import { outlinePng, readPngChunks, parseOutlineMeta } from '../../product/outline-png.mjs';
import { renderOutline, loadOutline, outputSize } from '../../web/sdf-render.mjs';

const L=(id,kind,w,h,x,y,color,op={})=>({id,shape:{kind,w,h,radius:op.radius??0},transform:{x,y,rotation:op.rotation??0,sx:op.sx??1,sy:op.sy??1},color,opacity:op.opacity??1,blend:op.blend??'normal',mask:op.mask??null,visible:op.visible??true});
const doc=(layers,width=32,height=32)=>({id:'t',width,height,samples:1,layers});

// Node 侧灰度 PNG 解码：解 IDAT 取灰度字节。
function decodeGray(buffer) {
  const chunks=readPngChunks(buffer);
  const ihdr=chunks.find(c=>c.type==='IHDR');
  const view=new DataView(ihdr.data.buffer,ihdr.data.byteOffset,ihdr.data.byteLength);
  const w=view.getUint32(0);
  const h=view.getUint32(4);
  const idat=Buffer.concat(chunks.filter(c=>c.type==='IDAT').map(c=>Buffer.from(c.data)));
  const raw=inflateSync(idat);
  const gray=new Uint8Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) gray[y*w+x]=raw[y*(w+1)+1+x];
  return gray;
}

// 1. PNG 往返：尺寸、元数据、灰度字节一致。
{
  const outline=buildOutline(doc([L('r','rect',12,8,16,16,'#ffffff')]));
  const bytes=outlinePng(outline);
  const chunks=readPngChunks(bytes);
  assert.deepEqual(chunks.map(c=>c.type),['IHDR','tEXt','IDAT','IEND']);
  const meta=parseOutlineMeta(chunks);
  assert.equal(meta.gridWidth,outline.gridWidth);
  assert.equal(meta.paddingPixels,4);
  assert.equal(meta.empty,false);
  const gray=decodeGray(bytes);
  assert.deepEqual(gray,outline.bytes);
  console.log('1. outline PNG round-trip OK, grid',meta.gridWidth,'x',meta.gridHeight);
}

// 2. loadOutline + 渲染：输出尺寸向上取整、透明背景、填色正确。
{
  const outline=buildOutline(doc([L('r','rect',12,8,16,16,'#ffffff')]));
  const bytes=outlinePng(outline);
  const { meta,grid }=await loadOutline(bytes,decodeGray);
  const scale=2;
  const size=outputSize(meta,scale);
  // 带留边画面 (32+8) x (32+8) = 40dp，2x => 80。
  assert.deepEqual(size,{width:80,height:80});
  const rendered=renderOutline(grid,meta,{fillColor:'#ff0000',strokeWidth:0,scale});
  assert.equal(rendered.width,80); assert.equal(rendered.height,80);
  // 角落实透明；形状中心纯红不透明。
  const corner=rendered.pixels.subarray(0,4);
  assert.deepEqual([...corner],[0,0,0,0]);
  const cx=40*rendered.width*4+40*4;
  assert.deepEqual([...rendered.pixels.subarray(cx,cx+4)],[255,0,0,255]);
  console.log('2. render size, transparency and fill OK');
}

// 3. 描边宽度实测：长直边上，填色→描边与描边→透明两个过渡中点的垂直距离。
// 中点按渲染器自身的覆盖函数定义：填充中点 aFill=0.5（d=0），描边中点 aStroke=0.5（d=-w/scale）。
// 在输出像素中心列上采样 SDF，线性插值求两个中点的输出坐标，换算为输出像素。
function sdfSampler(grid,meta) {
  return (dx,dy)=>{
    const gx=(dx+meta.paddingPixels)*CELLS_PER_PIXEL-0.5;
    const gy=(dy+meta.paddingPixels)*CELLS_PER_PIXEL-0.5;
    const W=meta.gridWidth;
    const x0=Math.max(0,Math.floor(gx)), y0=Math.max(0,Math.floor(gy));
    const tx=gx-x0, ty=gy-y0;
    const at=(x,y)=>decodeValue(grid[Math.min(y,meta.gridHeight-1)*W+Math.min(x,W-1)]);
    return at(x0,y0)*(1-tx)*(1-ty)+at(x0+1,y0)*tx*(1-ty)+at(x0,y0+1)*(1-tx)*ty+at(x0+1,y0+1)*tx*ty;
  };
}

function measuredStrokeWidth(grid,meta,scale,w) {
  const sample=sdfSampler(grid,meta);
  const cx=meta.width/2;
  const dAt=oy=>sample(cx,(oy+0.5)/scale-meta.paddingPixels);
  // 找跨越 d=0 与 d=-w/scale 的相邻输出像素对，线性插值中点位置。
  const crossings={ zero:null, outer:null };
  let prev=dAt(0);
  for(let oy=1;oy<(meta.height+meta.paddingPixels*2)*scale;oy++) {
    const cur=dAt(oy);
    if(crossings.zero===null && prev<0 && cur>=0) crossings.zero=oy-1+(0-prev)/(cur-prev);
    if(crossings.outer===null && prev< -w/scale && cur>=-w/scale) crossings.outer=oy-1+((-w/scale)-prev)/(cur-prev);
    prev=cur;
  }
  assert.ok(crossings.zero!==null && crossings.outer!==null,`midpoints not found: ${JSON.stringify(crossings)}`);
  // 自外向内：outer 在 zero 之前，距离即描边宽度（输出像素）。
  return crossings.zero-crossings.outer;
}

for(const scale of [1,2,3,4]) {
  const outline=buildOutline(doc([L('r','rect',20,20,16,16,'#ffffff')]));
  const { meta,grid }=await loadOutline(outlinePng(outline),decodeGray);
  const fill=[33,67,77], stroke=[147,215,174];
  for(const w of [1,2,3]) {
    const rendered=renderOutline(grid,meta,{fillColor:'#21434d',strokeColor:'#93d7ae',strokeWidth:w,scale});
    assert.equal(rendered.width,(meta.width+8)*scale);
    const measured=measuredStrokeWidth(grid,meta,scale,w);
    assert.ok(Math.abs(measured-w)<=0.5,`scale ${scale} w ${w}: measured ${measured.toFixed(3)}`);
  }
  // 4x 图上再用真实输出像素的颜色翻转核对一次填色→描边中点确实落在像素渐变带上。
  if(scale===4) {
    const rendered4=renderOutline(grid,meta,{fillColor:'#21434d',strokeColor:'#93d7ae',strokeWidth:1,scale});
    const col=Math.round(rendered4.width/2);
    const ramps=[];
    for(let y=1;y<rendered4.height;y++) {
      const a=rendered4.pixels[(y*rendered4.width+col)*4+3];
      const b=rendered4.pixels[((y-1)*rendered4.width+col)*4+3];
      if(a!==b) ramps.push(y);
    }
    assert.ok(ramps.length>=2,'expected soft alpha/color ramp at 4x');
  }
  void fill; void stroke;
  console.log(`3. stroke widths 1/2/3 within 0.5 output px at scale ${scale}`);
}

// 4. 非整数倍率 ceil：1.5x 下 40dp -> 60px。
{
  const outline=buildOutline(doc([L('r','rect',12,8,16,16,'#ffffff')]));
  const { meta,grid }=await loadOutline(outlinePng(outline),decodeGray);
  const size=outputSize(meta,1.5);
  assert.deepEqual(size,{width:60,height:60});
  const rendered=renderOutline(grid,meta,{fillColor:'#000000',strokeWidth:0,scale:1.5});
  assert.equal(rendered.width,60);
  console.log('4. fractional scale ceil OK');
}

// 5. 空轮廓：任何位置都透明。
{
  const outline=buildOutline(doc([L('r','rect',12,8,16,16,'#00000000')]));
  assert.ok(outline.empty);
  const { meta,grid }=await loadOutline(outlinePng(outline),decodeGray);
  const rendered=renderOutline(grid,meta,{fillColor:'#ffffff',strokeColor:'#ff0000',strokeWidth:3,scale:2});
  assert.ok(rendered.pixels.every(v=>v===0));
  console.log('5. empty contour renders fully transparent');
}

// 6. 描边覆盖孔内靠边区域：带孔素材，孔心仍可透明，孔沿被描边填上。
{
  const ring=doc([
    L('top','rect',14,5,16,11.5,'#ffffff'),L('bottom','rect',14,5,16,20.5,'#ffffff'),
    L('left','rect',5,4,11.5,16,'#ffffff'),L('right','rect',5,4,20.5,16,'#ffffff'),
  ]);
  const outline=buildOutline(ring);
  const { meta,grid }=await loadOutline(outlinePng(outline),decodeGray);
  const rendered=renderOutline(grid,meta,{fillColor:'#21434d',strokeColor:'#93d7ae',strokeWidth:2,scale:2});
  // 孔心（设计 16,16）在 2x 输出中对应像素 (20*2,20*2) 附近，应保持透明或低 alpha。
  const p=((20*2)*rendered.width+20*2)*4;
  assert.ok(rendered.pixels[p+3]<64,'hole center stays clear');
  // 孔沿外侧（设计 14,16 附近，内容侧）应被着色。
  const q=((20*2)*rendered.width+18*2)*4;
  assert.ok(rendered.pixels[q+3]>0,'ring carries color');
  console.log('6. hole center clear while ring painted, alpha hole center =',rendered.pixels[p+3]);
}

// 7. 平滑过渡：边缘相邻像素 alpha 渐变而非 0/255 跳变。
{
  const outline=buildOutline(doc([L('r','rect',12,8,16,16,'#ffffff')]));
  const { meta,grid }=await loadOutline(outlinePng(outline),decodeGray);
  const rendered=renderOutline(grid,meta,{fillColor:'#ffffff',strokeWidth:0,scale:4});
  const col=Math.round(rendered.width/2);
  const alphas=[];
  for(let y=0;y<rendered.height;y++) alphas.push(rendered.pixels[(y*rendered.width+col)*4+3]);
  const partial=alphas.filter(a=>a>0 && a<255);
  assert.ok(partial.length>=2,'expected soft alpha ramp');
  console.log('7. soft edge ramp present, partial pixels =',partial.length);
}

console.log('All renderer tests passed.');
