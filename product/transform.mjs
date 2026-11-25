import { number, object } from '../server/input.mjs';

export function normalizeTransform(value) {
  object(value,'放置');
  return {x:number(value.x,-768,768,'中心 X'), y:number(value.y,-768,768,'中心 Y'),
    rotation:number(value.rotation??0,-360,360,'角度'), sx:number(value.sx??1,.1,5,'缩放 X'), sy:number(value.sy??1,.1,5,'缩放 Y')};
}

export function inverse(transform) {
  const { x,y,rotation,sx,sy }=transform, a=rotation*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  return (px,py) => {
    const dx=px-x, dy=py-y;
    return [(c*dx+s*dy)/sx,(-s*dx+c*dy)/sy];
  };
}
