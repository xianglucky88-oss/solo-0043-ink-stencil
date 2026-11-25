import { requireThat } from '../server/input.mjs';

export function parseColor(hex) {
  requireThat(typeof hex==='string' && /^#[a-f\d]{6}([a-f\d]{2})?$/i.test(hex),'颜色使用 #RRGGBB 或 #RRGGBBAA');
  return hex.toLowerCase();
}

export function channels(hex) {
  return (hex.length===7 ? hex+'ff' : hex).slice(1).match(/../g).map(pair=>parseInt(pair,16)/255);
}
