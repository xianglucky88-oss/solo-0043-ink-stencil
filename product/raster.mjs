import { inverse } from './transform.mjs';
import { channels } from './color.mjs';
import { sampleCoverage } from './masks.mjs';
import { over, overGroup } from './blend.mjs';
import { buildPlan } from './groups.mjs';

export function raster(document) {
  const { width,height,samples }=document;
  const layers=document.layers.map(layer=>({ ...layer, rgba:channels(layer.color), toLocal:inverse(layer.transform),
    maskIndex:document.layers.findIndex(row=>row.id===layer.mask), hits:0 }));
  const { openAt, closeAt }=buildPlan(document, layers);
  const pixels=Buffer.alloc(width*height*4);
  const covered=new Uint8Array(layers.length);
  const sum=new Float64Array(4);
  // Reusable premultiplied accumulators: pool[0] is the outer canvas,
  // deeper entries are isolation-group buffers. Reset on every open.
  const pool=[new Float64Array(4)];
  let painted=0, partial=0;
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    sum.fill(0);
    for (let sy=0;sy<samples;sy++) for (let sx=0;sx<samples;sx++) {
      sampleCoverage(layers,x+(sx+.5)/samples,y+(sy+.5)/samples,covered);
      pool[0].fill(0);
      let depth=0;
      for (let i=0;i<layers.length;i++) {
        const opening=openAt[i];
        for (let k=0;k<opening.length;k++) {
          depth++;
          if (!pool[depth]) pool[depth]=new Float64Array(4);
          pool[depth].fill(0);
        }
        const pixel=pool[depth];
        const layer=layers[i], alpha=layer.opacity*layer.rgba[3];
        if (covered[i] && layer.visible && alpha) {
          layer.hits++;
          over(pixel,layer.rgba,alpha,layer.blend);
        }
        const closing=closeAt[i];
        for (let k=0;k<closing.length;k++) {
          const group=closing[k];
          const buffer=pool[depth];
          depth--;
          overGroup(pool[depth],buffer,group.opacity,group.blend);
        }
      }
      for (let i=0;i<4;i++) sum[i]+=pool[0][i];
    }
    const dest=(y*width+x)*4;
    const alpha=pixels[dest+3]=Math.round(255*sum[3]/(samples*samples));
    if (alpha) {
      painted++;
      if (alpha<255) partial++;
      for (let i=0;i<3;i++) pixels[dest+i]=Math.round(255*sum[i]/sum[3]);
    }
  }
  return {pixels, painted, partial, layers:layers.map(({id,visible,hits})=>({id,visible,hits}))};
}
