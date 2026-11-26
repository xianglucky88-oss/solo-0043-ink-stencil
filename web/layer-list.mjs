import { el } from './dom.mjs';

export function layerList(layers,rendered) {
  const list=el('ol',undefined,'layer-list');
  for(let i=layers.length-1;i>=0;i--){
    const layer=layers[i], row=el('li'), chip=el('i',undefined,'swatch'), label=el('div');
    row.dataset.layerId=layer.id;
    const canvas=el('canvas');canvas.width=18;canvas.height=18;
    const ctx=canvas.getContext('2d');ctx.fillStyle=layer.color;ctx.fillRect(0,0,18,18);chip.append(canvas);
    const shape=layer.shape;
    const pieceText=shape?.kind==='contours' && Array.isArray(shape.pieces)
      ? ` · ${shape.pieces.length} 块${shape.pieces.some(p=>p.holes?.length)?' · 带孔':''}` : '';
    label.append(el('strong',layer.id),el('small',`${layer.blend}${layer.mask?` · 遮罩 ${layer.mask}`:''}${pieceText}`));
    row.append(chip,label,el('span',layer.visible?`${rendered[i].hits.toLocaleString()} 样本`:'仅遮罩','muted mono'));
    list.append(row);
  }
  return list;
}
