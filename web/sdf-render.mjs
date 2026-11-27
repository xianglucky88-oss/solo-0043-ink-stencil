import { decodeValue } from '../product/outline.mjs';
import { readPngChunks, parseOutlineMeta } from '../product/outline-png.mjs';

const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const smoothstep=t=>t*t*(3-2*t);

// 素材网格坐标：设计坐标 (x,y) 对应格坐标 (x+padding)*cellsPerPixel。
function makeSampler(grid, meta) {
  const { gridWidth:w, gridHeight:h, paddingPixels, cellsPerPixel, clipDistance }=meta;
  const outside=-clipDistance;
  return function sample(dx,dy) {
    const gx=(dx+paddingPixels)*cellsPerPixel-0.5;
    const gy=(dy+paddingPixels)*cellsPerPixel-0.5;
    if(gx<0 || gy<0 || gx>w-1 || gy>h-1) return outside;
    const x0=Math.floor(gx), y0=Math.floor(gy);
    const tx=gx-x0, ty=gy-y0;
    const x1=Math.min(x0+1,w-1), y1=Math.min(y0+1,h-1);
    const at=(x,y)=>decodeValue(grid[Math.max(0,y)*w+Math.max(0,x)]);
    const top=at(x0,y0)*(1-tx)+at(x1,y0)*tx;
    const bottom=at(x0,y1)*(1-tx)+at(x1,y1)*tx;
    return top*(1-ty)+bottom*ty;
  };
}

export function parseHexColor(value) {
  const match=/^#([a-f\d]{6})([a-f\d]{2})?$/i.exec(value);
  if(!match) throw new Error('颜色使用 #RRGGBB 或 #RRGGBBAA');
  return [parseInt(match[1].slice(0,2),16),parseInt(match[1].slice(2,4),16),parseInt(match[1].slice(4,6),16),
    match[2]?parseInt(match[2],16)/255:1];
}

// 整个带留边画面等比缩放，输出宽高分别向上取整。
export function outputSize(meta, scale) {
  const fullW=meta.width+meta.paddingPixels*2;
  const fullH=meta.height+meta.paddingPixels*2;
  return { width:Math.ceil(fullW*scale), height:Math.ceil(fullH*scale) };
}

// 纯函数渲染：输入解码后的灰度字节、素材参数与展示设置，输出直通 alpha RGBA。
// 描边宽度以输出像素计（0 表示只画填充；1–3 向外扩张，孔内靠边区域同样被覆盖）。
export function renderOutline(grid, meta, options) {
  const { fillColor, strokeColor=null, strokeWidth=0, scale }=options;
  const fill=parseHexColor(fillColor);
  const stroke=strokeColor ? parseHexColor(strokeColor) : null;
  const { width:outW, height:outH }=outputSize(meta,scale);
  const sample=makeSampler(grid,meta);
  const out=new Uint8ClampedArray(outW*outH*4);
  // 软边过渡半宽为一个输出像素（设计像素单位），保证边缘像素出现平滑的 alpha/颜色渐变；
  // 过渡中点仍精确落在 d=0（填色→描边）与 d=w（描边→透明），宽度计量不受影响。
  const aa=1/scale;
  const wDesign=strokeWidth/scale;
  for(let oy=0;oy<outH;oy++) for(let ox=0;ox<outW;ox++) {
    // 输出像素中心回到设计坐标（留边画面等比映射）。
    const dx=(ox+0.5)/scale-meta.paddingPixels;
    const dy=(oy+0.5)/scale-meta.paddingPixels;
    const d=sample(dx,dy);
    // 填充覆盖：过渡带 d ∈ [-aa, aa]，中点 d=0。
    const aFill=smoothstep(clamp((d+aa)/(2*aa),0,1));
    let aStroke=0;
    if(stroke && strokeWidth>0) {
      // 描边覆盖：d 越小越靠外，过渡带 d ∈ [-w-aa, -w+aa]，中点 d=-w。
      aStroke=smoothstep(clamp((d+(wDesign+aa))/(2*aa),0,1));
    }
    // 预乘直通：填充打底，描边再 source-over。
    const [fr,fg,fb,fa]=fill;
    let r=fr*aFill*fa, g=fg*aFill*fa, b=fb*aFill*fa, a=aFill*fa;
    if(stroke && strokeWidth>0) {
      const [sr,sg,sb,sa]=stroke;
      const as=aStroke*sa;
      r+=sr*as*(1-a); g+=sg*as*(1-a); b+=sb*as*(1-a);
      a+=as*(1-a);
    }
    const p=(oy*outW+ox)*4;
    if(a>0) {
      out[p]=Math.round(r/a); out[p+1]=Math.round(g/a); out[p+2]=Math.round(b/a); out[p+3]=Math.round(255*a);
    }
  }
  return { width:outW, height:outH, pixels:out };
}

// 从 PNG 字节（ArrayBuffer/Buffer/Uint8Array）读取素材：块参数 + 灰度像素。
export async function loadOutline(bytes, decodePng) {
  const buffer=bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const chunks=readPngChunks(buffer);
  const meta=parseOutlineMeta(chunks);
  const grid=await decodePng(buffer);
  if(grid.length!==meta.gridWidth*meta.gridHeight) throw new Error('轮廓素材网格尺寸与参数不符');
  return { meta, grid };
}
