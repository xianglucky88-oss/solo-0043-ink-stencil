import { el } from './dom.mjs';
import { loadOutline, renderOutline, outputSize } from './sdf-render.mjs';

async function decodeGrayPng(bytes) {
  const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
  const canvas=document.createElement('canvas');
  canvas.width=bitmap.width; canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(bitmap,0,0);
  bitmap.close();
  // 灰度 PNG 在所有通道上数值相同，取红通道即可。
  const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const gray=new Uint8Array(canvas.width*canvas.height);
  for(let i=0;i<gray.length;i++) gray[i]=data[i*4];
  return gray;
}

function stateFrom(meta) {
  return { fillColor:'#21434d', strokeColor:'#93d7ae', strokeWidth:1, scale:1, meta, grid:null };
}

function draw(state, canvas) {
  const { width,height,pixels }=renderOutline(state.grid,state.meta,{
    fillColor:state.fillColor, strokeColor:state.strokeColor, strokeWidth:state.strokeWidth, scale:state.scale,
  });
  canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext('2d');
  ctx.putImageData(new ImageData(pixels,width,height),0,0);
}

function colorField(labelText, value) {
  const wrap=el('label',undefined,'field-inline'), input=el('input');
  input.type='color'; input.value=value.length===9 ? value.slice(0,7) : value;
  wrap.append(el('span',labelText),input);
  return { wrap, input };
}

// 离线单色徽记工作台：只用轮廓素材即可换色、换倍率、换描边宽度。
export async function mountOutline(container, { previewOutline, frozenId }) {
  container.replaceChildren(el('h4','单色轮廓素材'));
  if(!previewOutline) {
    container.append(el('p','轮廓素材生成中…','muted'));
    return ()=>{};
  }
  const { meta, base64 }=previewOutline;
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  const loaded=await loadOutline(bytes,decodeGrayPng);
  const state=stateFrom(loaded.meta); state.grid=loaded.grid;

  const canvas=el('canvas',undefined,'raster outline-raster');
  const mat=el('div',undefined,'proof-mat outline-mat'); mat.append(canvas);
  const size=outputSize(state.meta,state.scale);
  const sizeNote=el('output',`${size.width} × ${size.height} 输出像素`,'mono');
  draw(state,canvas);

  const fill=colorField('填色',state.fillColor);
  const stroke=colorField('描边色',state.strokeColor);
  const widthRow=el('label',undefined,'field-inline');
  const widthSelect=el('select');
  for(const w of [0,1,2,3]) { const option=el('option', w===0?'仅填充':`${w} 输出像素`); option.value=String(w); widthSelect.append(option); }
  widthSelect.value=String(state.strokeWidth);
  widthRow.append(el('span','描边宽度'),widthSelect);

  const scaleRow=el('label',undefined,'field-inline');
  const scaleInput=el('input');
  scaleInput.type='number'; scaleInput.min='1'; scaleInput.max='4'; scaleInput.step='0.1'; scaleInput.value=String(state.scale);
  scaleRow.append(el('span','展示倍率'),scaleInput);

  const controls=el('div',undefined,'outline-controls');
  controls.append(fill.wrap,stroke.wrap,widthRow,scaleRow);

  const refresh=()=>{
    state.fillColor=fill.input.value; state.strokeColor=stroke.input.value;
    state.strokeWidth=Number(widthSelect.value);
    const scale=Number(scaleInput.value);
    if(!Number.isFinite(scale) || scale<1 || scale>4) return;
    state.scale=scale;
    draw(state,canvas);
    const out=outputSize(state.meta,state.scale);
    sizeNote.value=`${out.width} × ${out.height} 输出像素`;
  };
  for(const input of [fill.input,stroke.input,widthSelect,scaleInput]) input.addEventListener('input',refresh);

  const download=el('button','下载轮廓素材');
  download.type='button';
  download.onclick=()=>{
    const blob=new Blob([bytes],{type:'image/png'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url; anchor.download=frozenId ? `ink-stencil-${frozenId.slice(0,12)}.outline.png`:'ink-stencil.outline.png';
    anchor.click(); URL.revokeObjectURL(url);
  };

  const downloadRow=el('div',undefined,'outline-download');
  downloadRow.append(download,sizeNote);
  container.append(mat,controls,downloadRow);
  return refresh;
}
