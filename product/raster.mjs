import { inverse } from './transform.mjs';
import { channels } from './color.mjs';
import { sampleCoverage } from './masks.mjs';
import { over } from './blend.mjs';

export function raster(document) {
  const { width,height,samples }=document;
  const indexOf=new Map(document.layers.map((layer,index)=>[layer.id,index]));
  const layers=document.layers.map(layer=>({ ...layer, rgba:channels(layer.color), toLocal:inverse(layer.transform),
    maskIndex:layer.mask==null?-1:indexOf.get(layer.mask),
    maskIndices:(layer.masks??[]).map(entry=>({index:indexOf.get(entry.id),operation:entry.operation})),
    hits:0 }));
  const pixels=Buffer.alloc(width*height*4);
  const covered=new Uint8Array(layers.length);
  covered.stamp=new Uint32Array(layers.length);
  const pixel=new Float64Array(4), sum=new Float64Array(4);
  let painted=0, partial=0, stamp=0;
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    sum.fill(0);
    for (let sy=0;sy<samples;sy++) for (let sx=0;sx<samples;sx++) {
      sampleCoverage(layers,x+(sx+.5)/samples,y+(sy+.5)/samples,covered,++stamp);
      pixel.fill(0);
      for (let i=0;i<layers.length;i++) {
        const layer=layers[i], alpha=layer.opacity*layer.rgba[3];
        if (!covered[i] || !layer.visible || !alpha) continue;
        layer.hits++;
        over(pixel,layer.rgba,alpha,layer.blend);
      }
      for (let i=0;i<4;i++) sum[i]+=pixel[i];
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
