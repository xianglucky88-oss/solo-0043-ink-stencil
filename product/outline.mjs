import { inverse } from './transform.mjs';
import { channels } from './color.mjs';
import { sampleCoverage } from './masks.mjs';
import { over } from './blend.mjs';

// 每个设计像素对应 2×2 个半像素方格；留边四周各 4 个设计像素，即 8 格。
export const CELLS_PER_PIXEL=2;
export const PADDING_PIXELS=4;
export const PADDING_CELLS=PADDING_PIXELS*CELLS_PER_PIXEL;
export const CLIP_DISTANCE=4;

// 与冻结稿相同的图层、变换、前序遮罩和透明度合成，在每个小格中心取点判定。
// 约定输入已通过 normalize：transform 的 sx/sy 等默认字段齐全，与 raster 同一契约。
function coveredGrid(document) {
  const { width,height }=document;
  const gridW=width*CELLS_PER_PIXEL+PADDING_CELLS*2;
  const gridH=height*CELLS_PER_PIXEL+PADDING_CELLS*2;
  const layers=document.layers.map(layer=>({ ...layer, rgba:channels(layer.color), toLocal:inverse(layer.transform),
    maskIndex:document.layers.findIndex(row=>row.id===layer.mask) }));
  const coverage=new Uint8Array(layers.length);
  const pixel=new Float64Array(4);
  const cells=new Uint8Array(gridW*gridH);
  for(let gy=0;gy<gridH;gy++) for(let gx=0;gx<gridW;gx++) {
    const x=(gx-PADDING_CELLS+0.5)/CELLS_PER_PIXEL, y=(gy-PADDING_CELLS+0.5)/CELLS_PER_PIXEL;
    // 原画布以外视为空：不读取任何图层，直接落空。
    if(x<0 || y<0 || x>=width || y>=height) continue;
    sampleCoverage(layers,x,y,coverage);
    pixel.fill(0);
    for(let i=0;i<layers.length;i++) {
      const layer=layers[i], alpha=layer.opacity*layer.rgba[3];
      if(!coverage[i] || !layer.visible || !alpha) continue;
      over(pixel,layer.rgba,alpha,layer.blend);
    }
    if(pixel[3]>=0.5) cells[gy*gridW+gx]=1;
  }
  return { cells, gridW, gridH };
}

function mergeIntervals(edges) {
  edges.sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
  const merged=[];
  for(const [lo,hi] of edges) {
    const last=merged[merged.length-1];
    if(last && lo<=last[1]) last[1]=Math.max(last[1],hi);
    else merged.push([lo,hi]);
  }
  return merged;
}

// 带常数项的抛物线包络：min_i (q-s_i)^2 + c_i。返回交点数组与站点数组。
function parabolaEnvelope(sites, constants) {
  const v=[], c=[], z=[];
  for(let k=0;k<sites.length;k++) {
    const s=sites[k], ck=constants[k];
    while(v.length) {
      const sPrev=v[v.length-1], cPrev=c[c.length-1];
      const intersect=((s*s+ck)-(sPrev*sPrev+cPrev))/(2*(s-sPrev));
      if(intersect<=z[z.length-1]) { v.pop(); c.pop(); z.pop(); } else break;
    }
    z.push(v.length ? ((s*s+ck)-(v[v.length-1]**2+c[c.length-1]))/(2*(s-v[v.length-1])) : -Infinity);
    v.push(s); c.push(ck);
  }
  return { v, c, z };
}

function envelopeAt(env,q) {
  let lo=0, hi=env.z.length-1;
  while(lo<hi) {
    const mid=(lo+hi+1)>>1;
    if(env.z[mid]<=q) lo=mid; else hi=mid-1;
  }
  const d=q-env.v[lo];
  return d*d+env.c[lo];
}

function nearestGap(intervals,q) {
  let best=Infinity;
  for(const [lo,hi] of intervals) {
    if(q>=lo && q<=hi) return 0;
    best=Math.min(best, q<lo ? lo-q : q-hi);
  }
  return best;
}

// 可分离线段距离变换：
// 第一遍沿平行方向求到各线段的间隙平方（点在线段覆盖区间内为 0）；
// 第二遍沿垂直方向做抛物线包络，垂直距离由半整数格心到整数格线的位置差自然给出。
// 横竖两组线段各跑一遍，取最小值，即精确的点到边界折线欧氏距离。
function segmentEDT(lineMap, gridW, gridH, vertical) {
  const lines=[...lineMap.entries()].map(([line,edges])=>[line,mergeIntervals(edges)]).sort((a,b)=>a[0]-b[0]);
  if(!lines.length) return null;
  // 竖边：线段沿 y 延伸（平行轴=行 gy），格线列号 gx 是垂直轴站点；
  // 横边：线段沿 x 延伸（平行轴=列 gx），格线行号 gy 是垂直轴站点。
  const parallelLen=vertical ? gridH : gridW;
  const perpLen=vertical ? gridW : gridH;
  // gap[i][q]：平行轴格心位置 q+0.5 到第 i 条线段的平行间隙平方。
  const gap=Array.from({length:lines.length},()=>new Float64Array(parallelLen));
  for(let q=0;q<parallelLen;q++) {
    for(let i=0;i<lines.length;i++) gap[i][q]=nearestGap(lines[i][1],q+0.5)**2;
  }
  const result=new Float64Array(gridW*gridH).fill(Infinity);
  const sites=lines.map(([line])=>line);
  for(let q=0;q<parallelLen;q++) {
    const env=parabolaEnvelope(sites,gap.map(row=>row[q]));
    for(let p=0;p<perpLen;p++) {
      const value=envelopeAt(env,p+0.5);
      // 竖边：q=gy、p=gx；横边：q=gx、p=gy。
      const gx=vertical ? p : q, gy=vertical ? q : p;
      result[gy*gridW+gx]=Math.min(result[gy*gridW+gx],value);
    }
  }
  return result;
}

// 求每个格心到二进制网格边界折线（共边、孔边都计入）的带符号欧氏距离（设计像素单位）。
// 边界沿网格线落在整数格点上；用横、竖边界线段做两次可分离的距离变换。
export function signedDistances(cells, gridW, gridH) {
  const count=gridW*gridH;
  const any=cells.some(Boolean);
  if(!any) return { distances:Float64Array.from({length:count},()=>-CLIP_DISTANCE), empty:true };

  // 竖边：line 为格线列号（0..gridW），记录跨越该线、行号在 [lo,hi) 的边。
  const vertical=new Map();
  // 横边：line 为格线行号（0..gridH），记录跨越该线、列号在 [lo,hi) 的边。
  const horizontal=new Map();
  const addEdge=(map,line,along)=>{
    if(!map.has(line)) map.set(line,[]);
    map.get(line).push(along);
  };
  for(let gy=0;gy<gridH;gy++) for(let gx=0;gx<gridW;gx++) {
    if(!cells[gy*gridW+gx]) continue;
    const idx=gy*gridW+gx;
    if(gx===0 || !cells[idx-1]) addEdge(vertical,gx,[gy,gy+1]);
    if(gx===gridW-1 || !cells[idx+1]) addEdge(vertical,gx+1,[gy,gy+1]);
    if(gy===0 || !cells[idx-gridW]) addEdge(horizontal,gy,[gx,gx+1]);
    if(gy===gridH-1 || !cells[idx+gridW]) addEdge(horizontal,gy+1,[gx,gx+1]);
  }

  const sq=new Float64Array(count).fill(Infinity);
  const vSq=segmentEDT(vertical,gridW,gridH,true);
  const hSq=segmentEDT(horizontal,gridW,gridH,false);
  for(let i=0;i<count;i++) sq[i]=Math.min(vSq? vSq[i]:Infinity, hSq? hSq[i]:Infinity);

  const distances=new Float64Array(count);
  const cellToPixel=1/CELLS_PER_PIXEL;
  for(let i=0;i<count;i++) {
    const d=Math.sqrt(sq[i])*cellToPixel;
    distances[i]=Math.max(-CLIP_DISTANCE, Math.min(CLIP_DISTANCE, cells[i] ? d : -d));
  }
  return { distances, empty:false };
}

// 量化到单字节：0 → 负四，255 → 正四，步长 8/255 ≈ 1/32（读数误差不超过 1/32）。
export function quantize(distances) {
  const bytes=new Uint8Array(distances.length);
  for(let i=0;i<distances.length;i++) {
    const q=Math.round((distances[i]+CLIP_DISTANCE)*255/(2*CLIP_DISTANCE));
    bytes[i]=Math.max(0,Math.min(255,q));
  }
  return bytes;
}

export function decodeValue(byteValue) {
  return byteValue*(2*CLIP_DISTANCE)/255-CLIP_DISTANCE;
}

export function buildOutline(document) {
  const { width,height }=document;
  const { cells,gridW,gridH }=coveredGrid(document);
  const { distances,empty }=signedDistances(cells,gridW,gridH);
  const bytes=quantize(distances);
  return {
    width, height,
    gridWidth:gridW, gridHeight:gridH,
    paddingPixels:PADDING_PIXELS,
    cellsPerPixel:CELLS_PER_PIXEL,
    clipDistance:CLIP_DISTANCE,
    empty,
    cells,
    distances,
    bytes,
  };
}
