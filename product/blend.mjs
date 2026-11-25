function channel(mode, source, backdrop) {
  if (mode==='multiply') return source*backdrop;
  if (mode==='screen') return 1-(1-source)*(1-backdrop);
  return source;
}

// The running color stores premultiplied channels to preserve transparent edges.
export function over(pixel, color, alpha, mode) {
  const baseAlpha=pixel[3];
  for (let i=0;i<3;i++) {
    const base=baseAlpha===0 ? 0 : pixel[i]/baseAlpha;
    const weighted=(1-baseAlpha)*color[i]+baseAlpha*channel(mode,color[i],base);
    pixel[i]=pixel[i]*(1-alpha)+alpha*weighted;
  }
  pixel[3]=alpha+baseAlpha*(1-alpha);
}
