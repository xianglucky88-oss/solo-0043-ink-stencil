import { el } from './dom.mjs';

const maskText=layer=>{
  if(layer.mask) return ` · 遮罩 ${layer.mask}`;
  if(!layer.masks?.length) return '';
  const [first,second]=layer.masks;
  if(!second) return ` · 遮罩 ${first.id}`;
  return ` · 遮罩 ${first.id} ${second.operation==='union'?'并':'扣'} ${second.id}`;
};

export function layerList(layers,rendered) {
  const list=el('ol',undefined,'layer-list');
  for(let i=layers.length-1;i>=0;i--){
    const layer=layers[i], row=el('li'), chip=el('i',undefined,'swatch'), label=el('div');
    const canvas=el('canvas');canvas.width=18;canvas.height=18;
    const ctx=canvas.getContext('2d');ctx.fillStyle=layer.color;ctx.fillRect(0,0,18,18);chip.append(canvas);
    label.append(el('strong',layer.id),el('small',`${layer.blend}${maskText(layer)}`));
    row.append(chip,label,el('span',layer.visible?`${rendered[i].hits.toLocaleString()} 样本`:'仅遮罩','muted mono'));
    list.append(row);
  }
  return list;
}
