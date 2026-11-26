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

// Screen-space placement: local point -> canvas point, the exact inverse of inverse().
export function forward(transform) {
  const { x,y,rotation,sx,sy }=transform, a=rotation*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  return (u,v) => [x+c*sx*u-s*sy*v, y+s*sx*u+c*sy*v];
}

// Axis-aligned bounding box of a transformed local rectangle, in canvas coordinates.
export function transformedBounds(shape, transform) {
  const toScreen=forward(transform), rx=shape.w/2, ry=shape.h/2;
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const u of [-rx,rx]) for (const v of [-ry,ry]) {
    const [x,y]=toScreen(u,v);
    minX=Math.min(minX,x); maxX=Math.max(maxX,x);
    minY=Math.min(minY,y); maxY=Math.max(maxY,y);
  }
  return {minX,minY,maxX,maxY};
}
