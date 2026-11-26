import { choice, key, list, number, object, unique, requireThat } from '../server/input.mjs';
import { normalizeShape } from './shapes.mjs';
import { normalizeTransform } from './transform.mjs';
import { parseColor } from './color.mjs';
import { validateMaskOrder } from './masks.mjs';

export * from './merge.mjs';

export function normalize(input) {
  const width=number(input.width,16,512,'像素宽',true), height=number(input.height,16,512,'像素高',true);
  const samples=choice(input.samples,[1,2],'每轴采样');
  const layers=unique(list(input.layers,1,16,'图层').map(row=>{
    object(row,'图层');
    requireThat(typeof row.visible==='boolean','visible 必须是布尔值');
    return {id:key(row.id), shape:normalizeShape(row.shape), transform:normalizeTransform(row.transform),
      color:parseColor(row.color), opacity:number(row.opacity,0,1,'不透明度'),
      blend:choice(row.blend,['normal','multiply','screen'],'混合'), mask:row.mask==null?null:key(row.mask,'遮罩'), visible:row.visible};
  }),'图层');
  requireThat(width*height*samples*samples*layers.length<=8_000_000,'画布、采样和图层组合超出渲染预算');
  validateMaskOrder(layers);
  return {id:key(input.id), width,height,samples,layers};
}
