import assert from 'node:assert/strict';
import { buildOutline, PADDING_CELLS, CELLS_PER_PIXEL, decodeValue } from '../../product/outline.mjs';

// 设计坐标 (dx,dy) 处的格心索引（输入为半像素倍数的格心坐标）。
function cellIndex(o,dx,dy) {
  const gx=Math.round(dx*CELLS_PER_PIXEL+PADDING_CELLS);
  const gy=Math.round(dy*CELLS_PER_PIXEL+PADDING_CELLS);
  return gy*o.gridWidth+gx;
}

// 暴力参考：枚举所有边界线段，求点到折线的精确欧氏距离。
function bruteForceSDF(cells,gridW,gridH) {
  const segments=[];
  for(let gy=0;gy<gridH;gy++) for(let gx=0;gx<gridW;gx++) {
    if(!cells[gy*gridW+gx]) continue;
    const idx=gy*gridW+gx;
    const push=(x1,y1,x2,y2)=>segments.push([x1,y1,x2,y2]);
    if(gx===0 || !cells[idx-1]) push(gx,gy,gx,gy+1);
    if(gx===gridW-1 || !cells[idx+1]) push(gx+1,gy,gx+1,gy+1);
    if(gy===0 || !cells[idx-gridW]) push(gx,gy,gx+1,gy);
    if(gy===gridH-1 || !cells[idx+gridW]) push(gx,gy+1,gx+1,gy+1);
  }
  const dist=(px,py)=>{
    let best=Infinity;
    for(const [x1,y1,x2,y2] of segments) {
      const vx=x2-x1, vy=y2-y1;
      const t=Math.max(0,Math.min(1,((px-x1)*vx+(py-y1)*vy)/(vx*vx+vy*vy)));
      const dx=px-(x1+t*vx), dy=py-(y1+t*vy);
      best=Math.min(best,Math.hypot(dx,dy));
    }
    return best/CELLS_PER_PIXEL;
  };
  const out=new Float64Array(gridW*gridH);
  for(let gy=0;gy<gridH;gy++) for(let gx=0;gx<gridW;gx++) {
    const d=dist(gx+0.5,gy+0.5);
    out[gy*gridW+gx]=cells[gy*gridW+gx] ? d : -d;
  }
  return out;
};

function layer(id,kind,w,h,x,y,color,options={}) {
  const {rotation=0,radius=0,mask=null,opacity=1,blend='normal',visible=true,sx=1,sy=1}=options;
  return {id,shape:{kind,w,h,radius},transform:{x,y,rotation,sx,sy},color,opacity,blend,mask,visible};
}
const rectDoc=(layers,width=16,height=16,samples=1)=>({id:'t',width,height,samples,layers});
const maxError=(o)=>{
  const ref=bruteForceSDF(o.cells,o.gridWidth,o.gridHeight);
  let maxErr=0;
  for(let i=0;i<ref.length;i++) if(Math.abs(ref[i])<4) maxErr=Math.max(maxErr,Math.abs(ref[i]-o.distances[i]));
  return maxErr;
};

// 1. 基础矩形：与暴力折线距离逐格对比，误差远小于 1/32。
{
  const doc=rectDoc([layer('r','rect',8,6,8,8,'#ffffff')]);
  const o=buildOutline(doc);
  const maxErr=maxError(o);
  assert.ok(maxErr<1/64,`separable SDF error ${maxErr}`);
  assert.equal(o.cells[cellIndex(o,4.25,8.25)],1);
  assert.equal(o.cells[cellIndex(o,3.75,8.25)],1);
  assert.equal(o.cells[cellIndex(o,3.25,8.25)],0);
  assert.ok(Math.abs(o.distances[cellIndex(o,3.75,8.25)]-0.25)<1e-12);
  assert.ok(Math.abs(o.distances[cellIndex(o,3.25,8.25)]+0.25)<1e-12);
  assert.ok(o.distances[0]<0); // 留边区负距离
  console.log('1. rect SDF maxErr vs brute force:',maxErr.toFixed(5));
}

// 2. 带孔素材：四块矩形拼成带孔环，孔边计入边界。
{
  const doc=rectDoc([
    layer('ring-top','rect',14,5,8,3.5,'#ffffff'),
    layer('ring-bottom','rect',14,5,8,12.5,'#ffffff'),
    layer('ring-left','rect',5,4,3.5,8,'#ffffff'),
    layer('ring-right','rect',5,4,12.5,8,'#ffffff'),
  ]);
  const o=buildOutline(doc);
  const maxErr=maxError(o);
  assert.ok(maxErr<1/64);
  // 孔内格心为负；紧邻孔边（孔边 x=10）两侧格心距离 ±0.25。
  assert.equal(o.cells[cellIndex(o,9.25,8.25)],0);
  assert.ok(o.distances[cellIndex(o,9.25,8.25)]<0,'hole interior negative');
  assert.equal(o.cells[cellIndex(o,9.75,8.25)],1);
  assert.ok(Math.abs(o.distances[cellIndex(o,9.75,8.25)]-0.25)<1e-9);
  assert.ok(Math.abs(o.distances[cellIndex(o,9.25,8.25)]+0.25)<1e-9);
  console.log('2. hole SDF maxErr:',maxErr.toFixed(5),'holeInside:',o.distances[cellIndex(o,9.25,8.25)].toFixed(3));
}

// 3. 半像素直边：矩形左边落在半像素格线 x=8.5（中心 12.5、宽 8）。
{
  const doc=rectDoc([layer('r','rect',8,8,12.5,8,'#ffffff')]);
  const o=buildOutline(doc);
  const rowStart=(8*CELLS_PER_PIXEL+PADDING_CELLS)*o.gridWidth;
  let firstContent=null;
  for(let gx=0;gx<o.gridWidth;gx++) {
    if(o.cells[rowStart+gx]) { firstContent=gx; break; }
  }
  // 首个内容格左缘格线对应设计坐标 8.5。
  const leftDesign=(firstContent-PADDING_CELLS)/CELLS_PER_PIXEL;
  assert.ok(Math.abs(leftDesign-8.5)<1e-9,`edge at ${leftDesign}, want 8.5`);
  assert.ok(maxError(o)<1/64);
  console.log('3. half-pixel edge at design x =',leftDesign);
}

// 4. 隐藏裁边层只裁形不着色。
{
  const doc=rectDoc([
    layer('clip','rect',4,16,6,8,'#ff00ff',{visible:false}),
    layer('ink','rect',16,16,8,8,'#ffffff',{mask:'clip'}),
  ]);
  const o=buildOutline(doc);
  // 裁剪层覆盖 x 4..8；其外为空、其内有内容，且裁剪层本身不着色。
  assert.equal(o.cells[cellIndex(o,9.25,8.25)],0);
  assert.equal(o.cells[cellIndex(o,6.25,8.25)],1);
  console.log('4. hidden mask clipping OK');
}

// 5. 半像素处的隐藏遮罩直边：遮罩右边落在 x=8.5。
{
  const doc=rectDoc([
    layer('clip','rect',5,16,6,8,'#ff00ff',{visible:false}), // x 3.5..8.5
    layer('ink','rect',16,16,8,8,'#ffffff',{mask:'clip'}),
  ]);
  const o=buildOutline(doc);
  let lastContent=-1;
  const rowStart=(8*CELLS_PER_PIXEL+PADDING_CELLS)*o.gridWidth;
  for(let gx=0;gx<o.gridWidth;gx++) if(o.cells[rowStart+gx]) lastContent=gx;
  const rightEdge=(lastContent+1-PADDING_CELLS)/CELLS_PER_PIXEL;
  assert.ok(Math.abs(rightEdge-8.5)<1e-9,`mask edge ${rightEdge}, want 8.5`);
  assert.ok(Math.abs(o.distances[rowStart+lastContent]-0.25)<1e-9);
  assert.ok(Math.abs(o.distances[rowStart+lastContent+1]+0.25)<1e-9);
  console.log('5. mask half-pixel edge at x =',rightEdge);
}

// 6. 量化误差 ≤ 1/32；空轮廓全部解码为 -4。
{
  const doc=rectDoc([layer('r','rect',8,6,8,8,'#00000000')]);
  const o=buildOutline(doc);
  assert.ok(o.empty);
  for(const b of o.bytes) assert.equal(decodeValue(b),-4);
  const full=buildOutline(rectDoc([layer('r','rect',8,6,8,8,'#ffffff')]));
  let maxQ=0;
  for(let i=0;i<full.distances.length;i++) maxQ=Math.max(maxQ,Math.abs(full.distances[i]-decodeValue(full.bytes[i])));
  assert.ok(maxQ<=1/32+1e-12,`quant error ${maxQ}`);
  console.log('6. quantization max error:',maxQ.toFixed(5),'; empty contour all -4');
}

// 7. 网格尺寸与留边。
{
  const o=buildOutline(rectDoc([layer('r','rect',4,4,8,8,'#ffffff')],24,20));
  assert.equal(o.gridWidth,24*2+16); assert.equal(o.gridHeight,20*2+16);
  assert.equal(o.cellsPerPixel,2); assert.equal(o.paddingPixels,4);
  console.log('7. grid dims',o.gridWidth,'x',o.gridHeight);
}

// 8. 旋转图层仍按变换后几何判定。
{
  const doc=rectDoc([layer('bar','rect',8,2,8,8,'#ffffff',{rotation:90})]);
  const o=buildOutline(doc);
  assert.equal(o.cells[cellIndex(o,8.25,8.25)],1);
  assert.equal(o.cells[cellIndex(o,11.25,8.25)],0);
  console.log('8. transformed layer OK');
}

console.log('All outline core tests passed.');
