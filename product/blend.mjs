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

// Composite a rendered isolation-group buffer (premultiplied RGBA) onto an
// outer accumulator. The group's own opacity scales the buffer exactly once,
// after every layer inside the group has been composited.
export function overGroup(pixel, group, groupOpacity, mode) {
  const sourceAlpha = group[3];
  if (sourceAlpha === 0 || groupOpacity === 0) return;
  const alpha = sourceAlpha * groupOpacity;
  const color = [
    group[0] / sourceAlpha,
    group[1] / sourceAlpha,
    group[2] / sourceAlpha,
  ];
  over(pixel, color, alpha, mode);
}
