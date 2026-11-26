import { InputError, key, requireThat } from '../server/input.mjs';

// Compound vector shape: one color layer owns several independently editable
// pieces; each piece is an outer ring plus any transparent holes. Coordinates
// live in layer-local pixel units centred on the layer origin.

const KIND_ALIASES = new Set(['contours', 'contour', 'pieces', 'piece', 'paths', 'path',
  'polygons', 'polygon', 'outline', 'outlines', 'trace', 'traced', 'vector', 'regions', 'compound']);
const COLLECTION_KEYS = ['pieces', 'parts', 'contours', 'paths', 'regions', 'components', 'items', 'shapes'];
const RING_KEYS = ['points', 'vertices', 'coords', 'coordinates', 'outline', 'contour', 'ring', 'path'];

export function isContourShape(shape) {
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) return false;
  if (typeof shape.kind === 'string' && KIND_ALIASES.has(shape.kind.toLowerCase())) return true;
  return COLLECTION_KEYS.some(k => shape[k] != null) || RING_KEYS.some(k => shape[k] != null) || Array.isArray(shape.rings);
}

function point(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]), y = Number(value[1]);
    requireThat(Number.isFinite(x) && Number.isFinite(y), '轮廓点必须是有限数值');
    return [x, y];
  }
  if (value && typeof value === 'object') {
    const x = Number(value.x), y = Number(value.y);
    requireThat(Number.isFinite(x) && Number.isFinite(y), '轮廓点必须包含数值 x/y');
    return [x, y];
  }
  throw new InputError('轮廓点使用 [x,y] 或 {x,y}');
}

// Accept [[x,y],...] or flat [x,y,x,y,...], closing implicitly.
function ring(value) {
  requireThat(Array.isArray(value), '轮廓环必须是点数组');
  let entries = value;
  if (value.length && typeof value[0] === 'number') {
    requireThat(value.length % 2 === 0, '扁平轮廓坐标必须成对出现');
    entries = [];
    for (let i = 0; i < value.length; i += 2) entries.push([value[i], value[i + 1]]);
  }
  const points = entries.map(point);
  if (points.length >= 2 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]) points.pop();
  requireThat(points.length >= 3, '轮廓环至少需要 3 个点');
  for (const [x, y] of points) {
    requireThat(Math.abs(x) <= 4096 && Math.abs(y) <= 4096, '轮廓坐标超出可编辑范围');
  }
  return points;
}

function ringOrNull(value) {
  if (value == null) return null;
  try { return ring(value); } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('轮廓环格式不正确');
  }
}

function normalizePiece(raw, index) {
  if (Array.isArray(raw)) {
    const outer = ring(raw); // bare ring: [[x,y],...] or flat [x,y,...]
    return finalizePiece({ outer, holes: [] }, index);
  }
  requireThat(raw && typeof raw === 'object', '每个分块必须是对象或轮廓点数组');
  let outer = null;
  for (const k of RING_KEYS) {
    if (raw[k] != null) { outer = ringOrNull(raw[k]); if (outer) break; }
  }
  let allRings = null;
  if (Array.isArray(raw.rings) && raw.rings.length) allRings = raw.rings.map(ring);
  let holes = [];
  if (raw.holes != null) {
    requireThat(Array.isArray(raw.holes), '孔轮廓必须是环数组');
    holes = raw.holes.map(ring);
  }
  if (!outer && allRings) outer = allRings[0];
  requireThat(outer, '分块缺少外轮廓点');
  if (!holes.length && allRings && allRings.length > 1) holes = allRings.slice(1);
  return finalizePiece({ id: raw.id, outer, holes }, index);
}

function finalizePiece({ id, outer, holes }, index) {
  let safeId;
  if (typeof id === 'string' && /^[a-zA-Z0-9][\w-]{0,31}$/.test(id)) safeId = id;
  else safeId = `piece-${index + 1}`;
  const rings = [outer, ...holes];
  return { id: safeId, points: outer, holes, rings };
}

export function normalizeContours(shape) {
  let collection = null;
  for (const k of COLLECTION_KEYS) {
    if (shape[k] != null) { collection = shape[k]; break; }
  }
  let rawPieces;
  if (collection != null) {
    rawPieces = collection;
  } else if (shape.rings != null || RING_KEYS.some(k => shape[k] != null)) {
    rawPieces = [shape];
  } else {
    throw new InputError('contours 轮廓需要 pieces 分块数组');
  }
  requireThat(Array.isArray(rawPieces) && rawPieces.length >= 1 && rawPieces.length <= 4096,
    '矢量分块需要 1–4096 项');
  const pieces = rawPieces.map(normalizePiece);
  const result = { kind: 'contours', pieces };
  if (Number.isFinite(shape.w)) result.w = shape.w;
  if (Number.isFinite(shape.h)) result.h = shape.h;
  return result;
}

// Even-odd ray crossing for one closed ring. Half-open vertex rule keeps
// neighbour handling deterministic without an epsilon.
export function pointInRing(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y)) {
      const crossX = xi + ((y - yi) * (xj - xi)) / (yj - yi);
      if (crossX > x) inside = !inside;
    }
  }
  return inside;
}

export function insideContours(shape, x, y) {
  for (const piece of shape.pieces) {
    let parity = false;
    for (const oneRing of piece.rings) parity = parity !== pointInRing(oneRing, x, y);
    if (parity) return true;
  }
  return false;
}

// Re-exported for callers that want to validate identifiers consistently.
export { key };
