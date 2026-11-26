import { choice, key, list, number, object, unique, requireThat } from '../server/input.mjs';
import { normalizeShape } from './shapes.mjs';
import { normalizeTransform } from './transform.mjs';
import { parseColor } from './color.mjs';
import { validateMaskOrder } from './masks.mjs';
import { normalizeGroupDraft, expandLayerWrappers } from './groups.mjs';

// Membership hints written directly on a layer are carried through so the
// attribution survives a freeze/reopen. Range and blend metadata live in
// the document's group declarations.
const LAYER_GROUP_KEYS = [
  'group', 'groupId', 'groupID', 'groupName', 'groups', 'parent',
  'blendGroup', 'isolationGroup', 'knockoutGroup', 'parentGroup',
];

function preserveGroupTags(row) {
  const tags = {};
  for (const tagKey of LAYER_GROUP_KEYS) {
    if (row[tagKey] !== undefined) tags[tagKey] = row[tagKey];
  }
  return tags;
}

export function normalize(rawInput) {
  object(rawInput, '工作文档');
  const input=expandLayerWrappers(rawInput);
  const width=number(input.width,16,512,'像素宽',true), height=number(input.height,16,512,'像素高',true);
  const samples=choice(input.samples,[1,2],'每轴采样');
  const rawLayers=list(input.layers,1,16,'图层');
  const layers=unique(rawLayers.map(row=>{
    object(row,'图层');
    requireThat(typeof row.visible==='boolean','visible 必须是布尔值');
    return {id:key(row.id), shape:normalizeShape(row.shape), transform:normalizeTransform(row.transform),
      color:parseColor(row.color), opacity:number(row.opacity,0,1,'不透明度'),
      blend:choice(row.blend,['normal','multiply','screen'],'混合'), mask:row.mask==null?null:key(row.mask,'遮罩'), visible:row.visible,
      ...preserveGroupTags(row)};
  }),'图层');
  requireThat(width*height*samples*samples*layers.length<=8_000_000,'画布、采样和图层组合超出渲染预算');
  validateMaskOrder(layers);
  let groups=normalizeGroupDraft(input,layers);
  if(groups===undefined && Array.isArray(input.groups)) groups=[];
  return {id:key(input.id), width,height,samples,layers,...(groups!==undefined?{groups}:{})};
}
