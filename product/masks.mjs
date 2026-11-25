import { requireThat } from '../server/input.mjs';
import { includes } from './shapes.mjs';

export function validateMaskOrder(layers) {
  const seen = new Set();
  for (const layer of layers) {
    requireThat(!layer.mask || seen.has(layer.mask), `${layer.id} 的遮罩须是前方已声明图层`);
    seen.add(layer.id);
  }
}

export function sampleCoverage(layers, x, y, coverage) {
  for (let i=0;i<layers.length;i++) {
    const layer=layers[i];
    const [u,v]=layer.toLocal(x,y);
    coverage[i] = includes(layer.shape,u,v) && (layer.maskIndex===-1 || coverage[layer.maskIndex]);
  }
}
