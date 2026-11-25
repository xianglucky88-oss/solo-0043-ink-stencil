import { choice, number, object } from '../server/input.mjs';

export function normalizeShape(shape) {
  object(shape,'轮廓');
  const kind=choice(shape.kind,['ellipse','rect','diamond'],'轮廓类型');
  const w=number(shape.w,1,512,'轮廓宽'), h=number(shape.h,1,512,'轮廓高');
  return {kind,w,h,...(kind==='rect' ? {radius:number(shape.radius??0,0,Math.min(w,h)/2,'圆角')} : {})};
}

export function includes(shape,x,y) {
  const a=Math.abs(x), b=Math.abs(y), rx=shape.w/2, ry=shape.h/2;
  if (a>rx || b>ry) return false;
  if (shape.kind==='ellipse') return (a/rx)**2+(b/ry)**2<=1;
  if (shape.kind==='diamond') return a/rx+b/ry<=1;
  const r=shape.radius;
  return Math.max(0,a-rx+r)**2+Math.max(0,b-ry+r)**2<=r*r;
}
