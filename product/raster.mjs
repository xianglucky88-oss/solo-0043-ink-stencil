import { inverse } from './transform.mjs';
import { channels } from './color.mjs';
import { sampleCoverage } from './masks.mjs';
import { over } from './blend.mjs';

// Runs the exact per-subsample layer stack used by the proof, seeding the
// running pixel with a backdrop instead of transparency.
//
// `backdrop` is either:
//   - { rgb:[r,g,b], alpha:a }: a uniform backdrop shared by every pixel,
//   - { width,height,pixels }: per-pixel straight 8-bit RGBA of the canvas
//     size; every subsample of one output pixel shares that pixel's color and
//     coverage (the page-side background image contract),
//   - null: transparent backdrop, matching the shipped proof.
// Returns the averaged premultiplied RGBA pixel values.
export function rasterPremultiplied(document, backdrop) {
  const { width,height,samples }=document;
  const perPixel = backdrop && backdrop.pixels;
  if (perPixel && (backdrop.width!==width || backdrop.height!==height)) {
    throw new Error(`底图尺寸 ${backdrop.width}×${backdrop.height} 与画布 ${width}×${height} 不一致，已停止出图`);
  }
  const uniformAlpha = backdrop && !perPixel ? backdrop.alpha : 0;
  const uniformSeed = backdrop && !perPixel && backdrop.alpha>0
    ? backdrop.rgb.map(channel=>channel*backdrop.alpha) : [0,0,0];
  const layers=document.layers.map(layer=>({ ...layer, rgba:channels(layer.color), toLocal:inverse(layer.transform),
    maskIndex:document.layers.findIndex(row=>row.id===layer.mask), hits:0 }));
  const premultiplied=new Float64Array(width*height*4);
  const covered=new Uint8Array(layers.length);
  const pixel=new Float64Array(4), sum=new Float64Array(4);
  let painted=0, partial=0;
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    sum.fill(0);
    for (let sy=0;sy<samples;sy++) for (let sx=0;sx<samples;sx++) {
      sampleCoverage(layers,x+(sx+.5)/samples,y+(sy+.5)/samples,covered);
      if (perPixel) {
        const seed=(y*width+x)*4;
        const alpha=backdrop.pixels[seed+3]/255;
        pixel[3]=alpha;
        for (let channel=0;channel<3;channel++) pixel[channel]=backdrop.pixels[seed+channel]/255*alpha;
      } else {
        pixel[0]=uniformSeed[0]; pixel[1]=uniformSeed[1]; pixel[2]=uniformSeed[2]; pixel[3]=uniformAlpha;
      }
      for (let i=0;i<layers.length;i++) {
        const layer=layers[i], alpha=layer.opacity*layer.rgba[3];
        if (!covered[i] || !layer.visible || !alpha) continue;
        layer.hits++;
        over(pixel,layer.rgba,alpha,layer.blend);
      }
      for (let i=0;i<4;i++) sum[i]+=pixel[i];
    }
    const dest=(y*width+x)*4, weight=samples*samples;
    for (let i=0;i<4;i++) premultiplied[dest+i]=sum[i]/weight;
    const alphaByte=Math.round(255*sum[3]/weight);
    if (alphaByte) { painted++; if (alphaByte<255) partial++; }
  }
  return { premultiplied, painted, partial, layers:layers.map(({id,visible,hits})=>({id,visible,hits})) };
}

// The shipped proof: average premultiplied subsamples, then un-premultiply to
// straight RGBA; fully transparent pixels encode zero RGB.
export function raster(document) {
  const { width,height }=document;
  const { premultiplied, painted, partial, layers }=rasterPremultiplied(document,null);
  const pixels=Buffer.alloc(width*height*4);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const dest=(y*width+x)*4;
    const alpha=pixels[dest+3]=Math.round(255*premultiplied[dest+3]);
    if (alpha) for (let i=0;i<3;i++) pixels[dest+i]=Math.round(255*premultiplied[dest+i]/premultiplied[dest+3]);
  }
  return {pixels, painted, partial, layers};
}
