import { el, metrics } from './dom.mjs';
import { probe } from './pixel-probe.mjs';
import { layerList } from './layer-list.mjs';
import { mountAnimationBar } from './animation-ui.mjs';

export const mountImport=null;
export const fields=[['输出宽度','width','number',[16,512,1]],['输出高度','height','number',[16,512,1]],['像素采样','samples','number',[1,2,1]]];

export async function present({stage,inspect,summary,document,url,activeFrame=null,apngUrl=null,onFrame,onExport}) {
  const mat=el('div',undefined,'proof-mat'), transport=el('div',undefined,'transport'), toggle=el('button','深色底');
  stage.append(mat);
  const sample=await probe(url,mat);
  toggle.setAttribute('aria-pressed','false');
  toggle.onclick=()=>{
    const active=mat.classList.toggle('dark-mat');
    toggle.setAttribute('aria-pressed',active);toggle.textContent=active?'棋盘格':'深色底';
  };
  transport.append(toggle,sample);

  const animationBar=mountAnimationBar({document,activeFrame,apngUrl,onFrame,onExport});
  if(animationBar) stage.append(animationBar);

  stage.append(transport,metrics([
    ['像素尺寸',`${summary.width} × ${summary.height}`],['非透明像素',summary.painted.toLocaleString()],['半透明像素',summary.partial.toLocaleString()],
  ]));
  inspect.append(el('h4','图层堆栈'),layerList(document.layers,summary.layers));
}
