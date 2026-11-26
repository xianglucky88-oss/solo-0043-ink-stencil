// Pixel-grid tracing: 4-connected pieces and exact boundary rings.
// Every opaque pixel is treated as the unit square [x,x+1]×[y,y+1]; boundary
// rings therefore sit on integer grid lines and reproduce the source exactly
// at both 1× and 2× sub-sample grids.

export function labelComponents(match, width, height) {
  const labels = new Int32Array(width * height).fill(-1);
  const components = [];
  for (let start = 0; start < width * height; start++) {
    if (!match(start) || labels[start] !== -1) continue;
    const id = components.length;
    const cells = [];
    const stack = [start];
    labels[start] = id;
    while (stack.length) {
      const p = stack.pop();
      const x = p % width, y = (p / width) | 0;
      cells.push([x, y]);
      const neighbors = [];
      if (x > 0) neighbors.push(p - 1);
      if (x + 1 < width) neighbors.push(p + 1);
      if (y > 0) neighbors.push(p - width);
      if (y + 1 < height) neighbors.push(p + width);
      for (const q of neighbors) {
        if (labels[q] === -1 && match(q)) { labels[q] = id; stack.push(q); }
      }
    }
    components.push({ id, cells });
  }
  return components;
}

const vkey = (x, y) => `${x},${y}`;
const ekey = (a, b) => `${vkey(...a)}>${vkey(...b)}`;

// Build the directed boundary edge set of one component. Cell edges are
// emitted clockwise on screen so outer rings end up with positive area.
function boundaryEdges(cells) {
  const live = new Map();
  const add = (a, b) => {
    const reverse = ekey(b, a);
    if (live.has(reverse)) live.delete(reverse);
    else live.set(ekey(a, b), { a, b, used: false });
  };
  for (const [x, y] of cells) {
    add([x, y], [x + 1, y]);         // top, left -> right
    add([x + 1, y], [x + 1, y + 1]); // right
    add([x + 1, y + 1], [x, y + 1]); // bottom, right -> left
    add([x, y + 1], [x, y]);         // left
  }
  return [...live.values()];
}

const TURN = {
  // incoming direction -> candidate outgoing preference order by |turn| desc
  '1,0': [[0, -1], [0, 1], [1, 0], [-1, 0]],
  '0,1': [[1, 0], [-1, 0], [0, 1], [0, -1]],
  '-1,0': [[0, 1], [0, -1], [-1, 0], [1, 0]],
  '0,-1': [[-1, 0], [1, 0], [0, -1], [0, 1]],
};

function stitchRings(edges) {
  const outgoing = new Map();
  for (const edge of edges) {
    const key = vkey(...edge.a);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push(edge);
  }
  const rings = [];
  for (const first of edges) {
    if (first.used) continue;
    const ring = [first.a];
    let edge = first;
    let startKey = vkey(...first.a);
    let guard = 0;
    while (edge && !edge.used && guard++ < edges.length + 4) {
      edge.used = true;
      ring.push(edge.b);
      if (vkey(...edge.b) === startKey) break;
      const choices = (outgoing.get(vkey(...edge.b)) ?? []).filter(item => !item.used);
      if (!choices.length) break;
      let next = choices[0];
      if (choices.length > 1 && ring.length >= 2) {
        const prev = ring[ring.length - 2], cur = edge.b;
        const d = [Math.sign(cur[0] - prev[0]), Math.sign(cur[1] - prev[1])];
        const preference = TURN[`${d[0]},${d[1]}`] ?? [];
        choices.sort((e1, e2) => {
          const rank = e => {
            const dir = [Math.sign(e.b[0] - e.a[0]), Math.sign(e.b[1] - e.a[1])];
            const idx = preference.findIndex(([x, y]) => x === dir[0] && y === dir[1]);
            return idx === -1 ? 99 : idx;
          };
          return rank(e1) - rank(e2);
        });
        next = choices[0];
      }
      edge = next;
    }
    if (ring.length >= 4 && vkey(...ring[0]) === vkey(...ring.at(-1))) rings.push(ring.slice(0, -1));
  }
  return rings;
}

function signedArea2(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

// Drop vertices where the path keeps a perfectly straight line.
function simplifyCollinear(ring) {
  if (ring.length <= 4) return ring;
  let result = ring.map(([x, y]) => [x, y]);
  let changed = true;
  while (changed && result.length > 4) {
    changed = false;
    const next = [];
    const n = result.length;
    for (let i = 0; i < n; i++) {
      const p = result[(i - 1 + n) % n], c = result[i], q = result[(i + 1) % n];
      const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
      if (cross === 0) { changed = true; continue; }
      next.push(c);
    }
    result = next;
  }
  return result;
}

export function traceComponent(cells) {
  const edges = boundaryEdges(cells);
  const rawRings = stitchRings(edges).map(simplifyCollinear);
  const rings = rawRings.filter(ring => ring.length >= 3);
  const sized = rings.map(ring => ({ ring, area: signedArea2(ring) }));
  // Positive area: outer contour (clockwise on screen); negative: hole.
  const outers = sized.filter(item => item.area > 0).map(item => item.ring);
  const holes = sized.filter(item => item.area < 0).map(item => item.ring);
  // Defensive fallback if a pinched boundary confused orientation.
  const outer = (outers.sort((a, b) => Math.abs(signedArea2(b)) - Math.abs(signedArea2(a)))[0])
    ?? rings.slice().sort((a, b) => Math.abs(signedArea2(b)) - Math.abs(signedArea2(a)))[0];
  return { rings, outer: outer ?? rings[0], holes };
}

export function traceMask(match, width, height) {
  return labelComponents(match, width, height).map(component => {
    const traced = traceComponent(component.cells);
    return { cellCount: component.cells.length, ...traced };
  });
}
