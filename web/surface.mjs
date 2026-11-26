import { el, metrics } from './dom.mjs';
import { probe } from './pixel-probe.mjs';
import { layerList } from './layer-list.mjs';

export const mountImport=null;
export const fields=[['输出宽度','width','number',[16,512,1]],['输出高度','height','number',[16,512,1]],['像素采样','samples','number',[1,2,1]]];

export async function present({stage,inspect,summary,document,url,mode,recomputed}) {
  const mat=el('div',undefined,'proof-mat'), transport=el('div',undefined,'transport'), toggle=el('button','深色底');
  stage.append(mat);
  const sample=await probe(url,mat);
  toggle.setAttribute('aria-pressed','false');
  toggle.onclick=()=>{
    const active=mat.classList.toggle('dark-mat');
    toggle.setAttribute('aria-pressed',active);toggle.textContent=active?'棋盘格':'深色底';
  };
  const rows=[
    ['像素尺寸',`${summary.width} × ${summary.height}`],
    ['非透明像素',summary.painted.toLocaleString()],
    ['半透明像素',summary.partial.toLocaleString()],
  ];
  if(mode==='incremental') rows.push(['本次重算像素',`${recomputed.toLocaleString()}（局部）`]);
  else if(mode) rows.push(['渲染方式',mode==='frozen'?'冻结成品':'整图重算']);
  transport.append(toggle,sample);stage.append(transport,metrics(rows));
  inspect.append(el('h4','图层堆栈'),layerList(document.layers,summary.layers));
}
