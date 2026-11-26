import { inverse } from './transform.mjs';
import { channels } from './color.mjs';
import { sampleCoverage } from './masks.mjs';
import { over } from './blend.mjs';

// Normalized layers carry everything the pixel loop needs; hits accumulate here.
export function prepareLayers(document) {
  return document.layers.map(layer=>({ ...layer, rgba:channels(layer.color), toLocal:inverse(layer.transform),
    maskIndex:document.layers.findIndex(row=>row.id===layer.mask), hits:0 }));
}

// Rasterize one axis-aligned pixel rectangle. Every output pixel goes through the
// same sub-sample loop as a full render, so partial results splice back exactly.
export function paint(document, layers, region) {
  const { width,height,samples }=document;
  const { x0=0, y0=0, x1=width, y1=height }=region??{};
  const pixels=Buffer.alloc((x1-x0)*(y1-y0)*4);
  const covered=new Uint8Array(layers.length);
  const pixel=new Float64Array(4), sum=new Float64Array(4);
  let painted=0, partial=0;
  for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++) {
    sum.fill(0);
    for (let sy=0;sy<samples;sy++) for (let sx=0;sx<samples;sx++) {
      sampleCoverage(layers,x+(sx+.5)/samples,y+(sy+.5)/samples,covered);
      pixel.fill(0);
      for (let i=0;i<layers.length;i++) {
        const layer=layers[i], alpha=layer.opacity*layer.rgba[3];
        if (!covered[i] || !layer.visible || !alpha) continue;
        layer.hits++;
        over(pixel,layer.rgba,alpha,layer.blend);
      }
      for (let i=0;i<4;i++) sum[i]+=pixel[i];
    }
    const dest=((y-y0)*(x1-x0)+(x-x0))*4;
    const alpha=pixels[dest+3]=Math.round(255*sum[3]/(samples*samples));
    if (alpha) {
      painted++;
      if (alpha<255) partial++;
      for (let i=0;i<3;i++) pixels[dest+i]=Math.round(255*sum[i]/sum[3]);
    }
  }
  return { pixels, painted, partial };
}

export function raster(document) {
  const { width,height }=document;
  const layers=prepareLayers(document);
  const result=paint(document,layers);
  return { width,height, ...result, layers:layers.map(({id,visible,hits})=>({id,visible,hits})) };
}
