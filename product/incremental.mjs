import { prepareLayers, paint } from './raster.mjs';
import { transformedBounds } from './transform.mjs';

const staticKeys=['shape','color','opacity','blend','mask','visible'];

function sameStaticLayer(a,b) {
  for (const key of staticKeys) if (JSON.stringify(a[key])!==JSON.stringify(b[key])) return false;
  return true;
}

// Local recompute is valid only when the canvas, sampling and every layer's
// static declaration stay equal, and the sole edits are transforms of hidden
// mask layers. Moving a visible layer, changing canvas size or samples, or
// editing anything else must trigger a full render instead.
export function diffDocuments(base,next) {
  if (!base || base.width!==next.width || base.height!==next.height || base.samples!==next.samples) return null;
  if (base.layers.length!==next.layers.length) return null;
  const moved=[];
  for (let i=0;i<next.layers.length;i++) {
    const before=base.layers[i], after=next.layers[i];
    if (before.id!==after.id || !sameStaticLayer(before,after)) return null;
    if (JSON.stringify(before.transform)!==JSON.stringify(after.transform)) {
      if (after.visible) return null;
      moved.push({index:i,before,after});
    }
  }
  return moved.length ? moved : [];
}

// Pixel rows/columns whose sub-sample points can touch the transformed box.
// Column x hosts sample coordinates x+0.5/s .. x+1-0.5/s, so it intersects
// [min,max] exactly when ceil(min-1+0.5/s) <= x <= floor(max-0.5/s). The range
// is therefore exact for coverage of the moved mask, not an over-estimate.
function inclusiveRange(min,max,samples,span) {
  const eps=1e-9;
  const from=Math.ceil(min-1+0.5/samples-eps);
  const to=Math.floor(max-0.5/samples+eps);
  if (to<from) return null;
  return [Math.max(0,from), Math.min(span-1,to)];
}

function unionRanges(a,b) {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0],b[0]), Math.max(a[1],b[1])];
}

export function affectedRegion(document, moved) {
  const { width,height,samples }=document;
  let cols=null, rows=null;
  for (const {before,after} of moved) {
    const oldBox=transformedBounds(before.shape,before.transform);
    const newBox=transformedBounds(after.shape,after.transform);
    cols=unionRanges(cols,unionRanges(
      inclusiveRange(oldBox.minX,oldBox.maxX,samples,width),
      inclusiveRange(newBox.minX,newBox.maxX,samples,width)));
    rows=unionRanges(rows,unionRanges(
      inclusiveRange(oldBox.minY,oldBox.maxY,samples,height),
      inclusiveRange(newBox.minY,newBox.maxY,samples,height)));
  }
  if (!cols || !rows) return {x0:0,y0:0,x1:0,y1:0};
  return {x0:cols[0], y0:rows[0], x1:cols[1]+1, y1:rows[1]+1};
}

function countStats(pixels) {
  let painted=0, partial=0;
  for (let i=3;i<pixels.length;i+=4) {
    if (pixels[i]) { painted++; if (pixels[i]<255) partial++; }
  }
  return { painted, partial };
}

function splice(full, region, width, patch) {
  const rw=region.x1-region.x0;
  for (let y=region.y0;y<region.y1;y++) {
    const target=(y*width+region.x0)*4, source=(y-region.y0)*rw*4;
    patch.copy(full,target,source,source+rw*4);
  }
}

// Rebuild a full render from the cached base pixels by repainting only the
// affected rectangle under the new submission. Base region stats and layer
// hits are replaced, never double-counted, so every output equals a from-scratch
// render of next.
export function renderIncremental(baseEntry, next) {
  const moved=diffDocuments(baseEntry.document,next);
  if (!moved) return null;
  const region=affectedRegion(next,moved);
  const baseLayers=prepareLayers(baseEntry.document);
  // Repainting the base region only serves to subtract its per-layer sample
  // hits; the pixel buffer itself is discarded in favour of the new one.
  paint(baseEntry.document,baseLayers,region);
  const nextLayers=prepareLayers(next);
  const nextRegion=paint(next,nextLayers,region);
  const pixels=Buffer.from(baseEntry.pixels);
  const patch=Buffer.from(nextRegion.pixels);
  splice(pixels,region,next.width,patch);
  const totals=countStats(pixels);
  const layers=nextLayers.map((layer,i)=>({
    id:layer.id, visible:layer.visible,
    hits:baseEntry.summary.layers[i].hits-baseLayers[i].hits+nextLayers[i].hits,
  }));
  return {
    pixels, patch, region,
    recomputed:(region.x1-region.x0)*(region.y1-region.y0),
    summary:{ id:next.id, width:next.width, height:next.height, samples:next.samples,
      painted:totals.painted, partial:totals.partial, layers },
  };
}
