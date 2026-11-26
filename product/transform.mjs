import { number, object, requireThat } from '../server/input.mjs';

const AFFINE_KEYS = ['affine', 'matrix', 'warp', 'basis', 'linear', 'xform', 'transformMatrix'];

function hasDirectAffine(value) {
  return value && typeof value === 'object' &&
    [value.a, value.b, value.c, value.d].every(Number.isFinite);
}

export function normalizeTransform(value) {
  object(value, '放置');
  const hasAffine = AFFINE_KEYS.some(key => value[key] != null) || hasDirectAffine(value);
  const x = hasAffine ? number(value.x ?? value.affine?.[4] ?? value.matrix?.[4] ?? 0, -1e7, 1e7, '中心 X')
                      : number(value.x, -768, 768, '中心 X');
  const y = hasAffine ? number(value.y ?? value.affine?.[5] ?? value.matrix?.[5] ?? 0, -1e7, 1e7, '中心 Y')
                      : number(value.y, -768, 768, '中心 Y');
  const result = {
    x,
    y,
    rotation: number(value.rotation ?? 0, -360, 360, '角度'),
    sx: number(value.sx ?? 1, .1, 5, '缩放 X'),
    sy: number(value.sy ?? 1, .1, 5, '缩放 Y'),
  };

  // A rectangle-to-rectangle alignment followed by a rotated layer can produce
  // a true skew.  The six values are row-major:
  // canvasX = a*localX + b*localY + tx; canvasY = c*localX + d*localY + ty.
  for (const key of AFFINE_KEYS) {
    if (value[key] == null) continue;
    result[key] = normalizeAffine(value[key], `放置仿射 ${key}`, value);
  }
  if (hasDirectAffine(value)) result.affine = normalizeAffine(value, '放置仿射');
  if (value.alignment != null) result.alignment = normalizeAlignment(value.alignment);
  return result;
}

export function normalizeAffine(value, label = '仿射', placement = {}) {
  let m;
  if (Array.isArray(value)) {
    if (value.length === 6) m = value;
    else if (value.length === 4) m = [
      value[0], value[1], value[2], value[3],
      firstFinite(value[4], placement.tx, placement.x, 0) ?? 0,
      firstFinite(value[5], placement.ty, placement.y, 0) ?? 0,
    ];
  } else if (value && typeof value === 'object') {
    if ([value.a, value.b, value.c, value.d].every(Number.isFinite)) {
      const tx = firstFinite(value.tx, value.x, value.e ?? 0);
      const ty = firstFinite(value.ty, value.y, value.f ?? 0);
      // DOMMatrix uses x = a*x + c*y + e, y = b*x + d*y + f.
      const dom = Number.isFinite(value.e) && Number.isFinite(value.f) &&
        !Number.isFinite(value.tx) && !Number.isFinite(value.x);
      m = dom ? [value.a, value.c, value.b, value.d, tx, ty]
              : [value.a, value.b, value.c, value.d, tx, ty];
    }
  }
  requireThat(value != null && typeof value === 'object', `${label} 必须是数组或对象`);
  requireThat(Array.isArray(m) && m.length === 6 && m.every(Number.isFinite), `${label} 需要六个有限数值`);
  requireThat(Math.abs(m[0] * m[3] - m[1] * m[2]) >= 1e-12, `${label} 不能退化`);
  requireThat(m.every(v => Math.abs(v) <= 1e7), `${label} 超出合理范围`);
  return m.map(v => Object.is(v, -0) ? 0 : v);
}

function firstFinite(...values) {
  return values.find(Number.isFinite);
}

export function normalizeAlignment(value) {
  object(value, '对位');
  return {
    source: normalizeRect(value.source ?? value.from ?? value.srcRect ?? value.sourceRect, '源对位框'),
    target: normalizeRect(value.target ?? value.to ?? value.targetRect ?? value.destinationRect, '目标对位框'),
  };
}

export function normalizeRect(value, label = '对位矩形') {
  let input = value;
  if (Array.isArray(value)) {
    requireThat(value.length === 4 && value.every(Number.isFinite), `${label} 需要四个数值`);
    input = { x: value[0], y: value[1], w: value[2], h: value[3] };
  }
  object(input, label);
  const centerX = firstFinite(input.cx, input.center?.x, input.position?.x);
  const centerY = firstFinite(input.cy, input.center?.y, input.position?.y);
  const x = firstFinite(input.x, input.left, input.x1, input.startX,
    Number.isFinite(centerX) ? centerX - rectWidth(input) / 2 : undefined);
  const y = firstFinite(input.y, input.top, input.y1, input.startY,
    Number.isFinite(centerY) ? centerY - rectHeight(input) / 2 : undefined);
  let w = rectWidth(input);
  let h = rectHeight(input);
  if (!Number.isFinite(w) && Number.isFinite(input.right ?? input.x2 ?? input.endX) && Number.isFinite(x)) {
    w = firstFinite(input.right, input.x2, input.endX) - x;
  }
  if (!Number.isFinite(h) && Number.isFinite(input.bottom ?? input.y2 ?? input.endY) && Number.isFinite(y)) {
    h = firstFinite(input.bottom, input.y2, input.endY) - y;
  }
  requireThat([x, y, w, h].every(Number.isFinite), `${label} 需要 x/y/w/h 或等价四边`);
  requireThat(w > 0 && h > 0, `${label} 的宽高必须为正数`);
  return { x, y, w, h };
}

function rectWidth(input) {
  return firstFinite(input.w, input.width);
}

function rectHeight(input) {
  return firstFinite(input.h, input.height);
}

export function assertRectInside(rect, width, height, label = '对位矩形') {
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
  const eps = 1e-6;
  requireThat(rect.x >= -eps && rect.y >= -eps &&
    rect.x + rect.w <= width + eps && rect.y + rect.h <= height + eps,
    `${label} 必须完全位于画布内`);
}

// Row-major affine local -> canvas.
export function forwardTransform(transform) {
  const t = transform ?? {};
  const nestedAffine = AFFINE_KEYS.map(key => t[key]).find(value => value != null);
  const affineValue = nestedAffine ?? (hasDirectAffine(t) ? t : null);
  let m;
  if (affineValue != null) {
    m = normalizeAffine(affineValue, '放置仿射');
    // normalizeAffine accepts four-element matrices and translates using x/y
    // only through object syntax; arrays of four need translation here.
    if (Array.isArray(affineValue) && affineValue.length === 4) {
      m[4] = t.x ?? 0;
      m[5] = t.y ?? 0;
    }
  } else {
    const x = t.x ?? 0, y = t.y ?? 0;
    const rotation = (t.rotation ?? 0) * Math.PI / 180;
    const c = Math.cos(rotation), s = Math.sin(rotation);
    const sx = t.sx ?? 1, sy = t.sy ?? 1;
    m = [c * sx, -s * sy, s * sx, c * sy, x, y];
  }
  if (t.alignment) m = composeAffine(rectToRectAffine(t.alignment.source, t.alignment.target), m);
  return m;
}

export function composeAffine(outer, inner) {
  const [a, b, c, d, tx, ty] = outer;
  const [e, f, g, h, ux, uy] = inner;
  return [
    a * e + b * g, a * f + b * h,
    c * e + d * g, c * f + d * h,
    a * ux + b * uy + tx, c * ux + d * uy + ty,
  ];
}

export function rectToRectAffine(source, target) {
  const s = normalizeRect(source, '源对位框'), r = normalizeRect(target, '目标对位框');
  const sx = r.w / s.w, sy = r.h / s.h;
  return [sx, 0, 0, sy, r.x - sx * s.x, r.y - sy * s.y];
}

export function inverse(transform) {
  const t = transform ?? {};
  const hasGeneral = AFFINE_KEYS.some(key => t[key] != null) || t.alignment != null || hasDirectAffine(t);
  if (hasGeneral) {
    const m = forwardTransform(t);
    const [a, b, c, d, tx, ty] = m;
    const det = a * d - b * c;
    requireThat(Number.isFinite(det) && Math.abs(det) >= 1e-12, '放置缩放不能为零');
    return (px, py) => {
      const dx = px - tx, dy = py - ty;
      return [(d * dx - b * dy) / det, (-c * dx + a * dy) / det];
    };
  }

  const { x, y, rotation, sx, sy } = normalizeTransform(t);
  const a = rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return (px, py) => {
    const dx = px - x, dy = py - y;
    return [(c * dx + s * dy) / sx, (-s * dx + c * dy) / sy];
  };
}
