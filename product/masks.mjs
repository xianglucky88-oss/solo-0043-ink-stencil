import { key, list, object, requireThat } from '../server/input.mjs';
import { includes } from './shapes.mjs';

// 遮罩与画面叠放顺序无关：只按唯一 ID 引用，引用指向堆栈中的任意一层。

// 规范化一层的遮罩引用。旧文档的 `mask`（字符串 ID 或空）保持原样；
// 新文档使用 `masks`：至多两个遮罩，第一个与自身轮廓取交集，
// 第二个可并入（union）或从第一个轮廓里扣除（subtract）。
export function normalizeMasks(row) {
  const hasSingle=row.mask!=null, hasMany=Array.isArray(row.masks) && row.masks.length>0;
  requireThat(!hasSingle || !hasMany,`${row.id} 的 mask 与 masks 只能二选一`);
  if (hasMany) {
    const entries=list(row.masks,1,2,'遮罩').map((entry,index)=>{
      object(entry,'遮罩');
      if (index===0) requireThat(entry.operation==null || entry.operation==='intersect',
        `${row.id} 的首个遮罩只能取交集`);
      else requireThat(entry.operation==='union' || entry.operation==='subtract',
        `${row.id} 的第二个遮罩允许：union、subtract`);
      return {id:key(entry.id,'遮罩'),operation:index===0?'intersect':entry.operation};
    });
    requireThat(new Set(entries.map(entry=>entry.id)).size===entries.length,`${row.id} 的遮罩不得重复`);
    return {mask:null,masks:entries};
  }
  if (hasSingle) {
    requireThat(typeof row.mask==='string',`${row.id} 的 mask 须是遮罩图层标识或为空`);
    return {mask:key(row.mask,'遮罩')};
  }
  return {mask:null};
}

// 校验遮罩图：每个引用都须指向存在的图层，且关系不得成环（含自引用）。
// 不再要求遮罩在前序位置，因此调整画面叠放顺序不会重接裁边关系。
export function validateMaskOrder(layers) {
  const ids=new Set(layers.map(layer=>layer.id));
  const refs=layer=>layer.masks?.length?layer.masks.map(entry=>entry.id):(layer.mask?[layer.mask]:[]);
  for (const layer of layers) for (const id of refs(layer)) {
    requireThat(ids.has(id),`${layer.id} 引用了找不到的遮罩 ${id}`);
  }
  const byId=new Map(layers.map(layer=>[layer.id,layer]));
  const state=new Map();
  const visit=layer=>{
    const mark=state.get(layer.id);
    if (mark===1) requireThat(false,`${layer.id} 的遮罩关系绕回到自身`);
    if (mark===2) return;
    state.set(layer.id,1);
    for (const id of refs(layer)) visit(byId.get(id));
    state.set(layer.id,2);
  };
  for (const layer of layers) visit(layer);
}

// 取一层在子样点 (x,y) 上的有效轮廓：自身几何先按当前放置与自身裁边得到轮廓，
// 再按 masks 的交/并/扣组合。遮罩几何与颜色、visible、opacity 完全无关，
// 因此隐藏、透明色或零不透明度都不会让轮廓消失。
// 布尔判定全部在单个子样点上完成，绝不在已平滑的遮罩上做代数叠加，
// 两倍采样经过像素中心时仍能保留原色与正确的半透明边。
export function sampleCoverage(layers, x, y, coverage, stamp) {
  const geometry=i=>{
    const layer=layers[i];
    const [u,v]=layer.toLocal(x,y);
    return includes(layer.shape,u,v);
  };
  const resolve=i=>{
    if (coverage.stamp[i]===stamp) return coverage[i];
    let inside=geometry(i);
    const layer=layers[i];
    if (inside && layer.maskIndex!==-1) inside=resolve(layer.maskIndex);
    for (const entry of (layer.maskIndices??[])) {
      const clipped=resolve(entry.index);
      inside=entry.operation==='union' ? inside||clipped
        : entry.operation==='subtract' ? inside&&!clipped
        : inside&&clipped;
    }
    coverage[i]=inside;
    coverage.stamp[i]=stamp;
    return inside;
  };
  for (let i=0;i<layers.length;i++) resolve(i);
}
