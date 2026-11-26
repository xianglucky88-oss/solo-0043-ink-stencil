import { el } from './dom.mjs';

// Build a layer-id -> group labels map. A layer can sit inside nested or
// equal-range shells; list every group whose resolved range contains it.
function groupIndex(groups) {
  const byLayer = new Map();
  if (!Array.isArray(groups)) return byLayer;
  groups.forEach((group, gi) => {
    const members = Array.isArray(group.layers) ? group.layers : null;
    if (members) for (const id of members) {
      if (!byLayer.has(id)) byLayer.set(id, []);
      byLayer.get(id).push(group.id ?? `组 ${gi + 1}`);
    }
  });
  return byLayer;
}

export function layerList(layers,rendered,groups) {
  const list=el('ol',undefined,'layer-list');
  const membership=groupIndex(groups);
  for(let i=layers.length-1;i>=0;i--){
    const layer=layers[i], row=el('li'), chip=el('i',undefined,'swatch'), label=el('div');
    const canvas=el('canvas');canvas.width=18;canvas.height=18;
    const ctx=canvas.getContext('2d');ctx.fillStyle=layer.color;ctx.fillRect(0,0,18,18);chip.append(canvas);
    const tags=membership.get(layer.id);
    const groupNote=tags?.length?` · 组 ${tags.join(' / ')}`:'';
    label.append(el('strong',layer.id),el('small',`${layer.blend}${layer.mask?` · 遮罩 ${layer.mask}`:''}${groupNote}`));
    row.append(chip,label,el('span',layer.visible?`${rendered[i].hits.toLocaleString()} 样本`:'仅遮罩','muted mono'));
    list.append(row);
  }
  return list;
}
