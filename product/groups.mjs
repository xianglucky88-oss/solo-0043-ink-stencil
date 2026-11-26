import { InputError, requireThat } from '../server/input.mjs';

// Isolated blending groups over contiguous runs of the flat layer stack.
//
// The source draft may describe groups through a number of equivalent
// spellings (id endpoints, index endpoints, explicit member lists or a
// `group` tag on layers). Everything is resolved here into interval
// descriptors; raster.mjs only consumes `start/end/parent`.

const BLEND_MODES = ['normal', 'multiply', 'screen'];

const COLLECTION_KEYS = [
  'groups', 'blendGroups', 'blend_groups', 'blendGroup',
  'isolationGroups', 'isolatedGroups', 'isolation', 'isolations',
  'knockoutGroups', 'knockouts', 'knockout',
  'compositeGroups', 'blendStacks', 'stacks',
];

const TAG_KEYS = [
  'group', 'groupId', 'groupID', 'groupName',
  'blendGroup', 'isolationGroup', 'knockoutGroup', 'parentGroup', 'parent',
];

const MEMBER_KEYS = ['layers', 'layerIds', 'ids', 'members', 'targets', 'items', 'indices', 'indexes', 'layerIndices'];

const TUPLE_KEYS = ['range', 'span', 'extent', 'interval', 'segment', 'between', 'at', 'indices', 'indexRange'];

const ENDPOINT_PAIRS = [
  ['from', 'to'],
  ['start', 'end'],
  ['begin', 'end'],
  ['first', 'last'],
  ['startAt', 'endAt'],
  ['fromIndex', 'toIndex'],
  ['startIndex', 'endIndex'],
  ['fromLayer', 'toLayer'],
  ['startLayer', 'endLayer'],
  ['layerStart', 'layerEnd'],
  ['startId', 'endId'],
  ['fromId', 'toId'],
  ['beginIndex', 'endIndex'],
];

const PARENT_KEYS = [
  'parent', 'parentId', 'parentID', 'parentGroup', 'parentGroupId',
  'outer', 'outerId', 'outerGroup', 'outerGroupId', 'outside', 'container', 'containerId',
];

const INNER_REF_KEYS = ['inner', 'innerId', 'innerGroup', 'innerGroupId', 'child', 'childId'];
const CHILDREN_KEYS = ['children', 'childGroups', 'innerGroups', 'nested', 'contains', 'groups'];

const RANK_KEYS = [
  'depth', 'level', 'tier', 'nestingDepth', 'nestLevel', 'nesting', 'nest',
  'order', 'ordering', 'nestOrder', 'rank', 'sequence', 'seq',
  'sortOrder', 'sort', 'priority', 'precedence',
  'z', 'zIndex', 'stage', 'step', 'phase', 'pass', 'index', 'tie', 'tieBreak', 'tiebreak',
  'stack', 'stackOrder', 'wrapOrder', 'shell',
];

const PARALLEL_KEYS = ['parallel', 'sibling', 'siblings', 'sideBySide'];

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function groupLabel(g, ordinal) {
  return g?.id ? `组 ${g.id}` : `第 ${ordinal + 1} 个混色组`;
}

// Find the raw group collection declared on the document, if any. Only
// array/object values count: string/boolean values under these names may be
// global isolation flags rather than group lists.
export function findCollection(input) {
  if (!isPlainObject(input)) return undefined;
  for (const key of COLLECTION_KEYS) {
    const value = input[key];
    if (Array.isArray(value) || isPlainObject(value)) return value;
  }
  return undefined;
}

function collectionEntries(collection) {
  const out = [];
  const walk = (value, inheritedParent) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, inheritedParent);
    } else if (isPlainObject(value)) {
      const ordinal = out.length;
      out.push({ raw: value, ordinal, inheritedParent });
      for (const key of NESTED_OBJECT_KEYS) {
        const children = value[key];
        if (Array.isArray(children)) {
          for (const child of children) {
            if (isPlainObject(child)) walk(child, value.id != null ? String(value.id) : inheritedParent);
          }
        }
      }
    } else if (typeof value === 'string' || typeof value === 'number') {
      out.push({ raw: { id: String(value) }, ordinal: out.length, inheritedParent });
    } else if (value === true && inheritedParent === undefined) {
      // Bare `true` map entries are handled by the map branch below.
    } else {
      throw new InputError('混色组必须是对象或标识');
    }
  };
  if (Array.isArray(collection)) {
    walk(collection, undefined);
    return out;
  }
  if (isPlainObject(collection)) {
    for (const [id, value] of Object.entries(collection)) {
      if (isPlainObject(value)) {
        const raw = { ...value, id: value.id ?? id };
        walk(raw, undefined);
      } else if (Array.isArray(value)) {
        out.push({ raw: { id, layers: value }, ordinal: out.length });
      } else if (value === true) {
        out.push({ raw: { id }, ordinal: out.length });
      } else if (typeof value === 'string' || typeof value === 'number') {
        out.push({ raw: { id, layers: [value] }, ordinal: out.length });
      } else {
        throw new InputError(`混色组 ${id} 的定义必须是对象或图层标识数组`);
      }
    }
    return out;
  }
  if (collection === undefined || collection === null) return [];
  throw new InputError('groups 必须是数组或以标识为键的对象');
}

const NESTED_OBJECT_KEYS = ['groups', 'children', 'childGroups', 'innerGroups', 'nestedGroups', 'nested'];

// Collect membership expressed with a `group` tag directly on layers.
function collectLayerTags(rawLayers) {
  const tags = new Map(); // group id -> Set<index>
  const inline = new Map(); // group id -> inline attribute object
  const stacks = []; // ordered outer->inner id lists written on a layer
  rawLayers.forEach((row, index) => {
    if (!isPlainObject(row)) return;
    const add = (id) => {
      if (id == null || id === false) return;
      const key = String(id);
      if (!tags.has(key)) tags.set(key, new Set());
      tags.get(key).add(index);
    };
    const considerStack = (value) => {
      if (Array.isArray(value) && value.every(v => ['string', 'number'].includes(typeof v))) {
        const ids = value.map(String);
        ids.forEach(add);
        if (ids.length > 1) stacks.push(ids);
      }
    };
    for (const key of TAG_KEYS) {
      const value = row[key];
      if (value == null || value === false) continue;
      if (typeof value === 'string' || typeof value === 'number') {
        add(value);
      } else if (Array.isArray(value)) {
        considerStack(value);
      } else if (isPlainObject(value)) {
        if (value.id != null) {
          add(value.id);
          if (!inline.has(String(value.id))) inline.set(String(value.id), value);
        }
      }
    }
    if (Array.isArray(row.groups)) considerStack(row.groups);
  });
  return { tags, inline, stacks };
}

function asIndex(ref, byId, count, label) {
  if (typeof ref === 'number' && Number.isInteger(ref)) {
    requireThat(ref >= 0 && ref < count, `${label}超出图层范围`);
    return ref;
  }
  if (typeof ref === 'string') {
    if (byId.has(ref)) return byId.get(ref);
    if (/^\d+$/.test(ref)) {
      const index = Number(ref);
      if (index >= 0 && index < count) return index;
    }
    throw new InputError(`${label}引用了不存在的图层 ${ref}`);
  }
  if (isPlainObject(ref) && ref.id != null) return asIndex(ref.id, byId, count, label);
  throw new InputError(`${label}须使用图层标识或整数序号`);
}

function contiguousRange(indices, label) {
  const sorted = [...indices].sort((a, b) => a - b);
  requireThat(sorted.length > 0, `${label}至少包含一个图层`);
  const start = sorted[0], end = sorted[sorted.length - 1];
  requireThat(
    end - start + 1 === sorted.length && new Set(sorted).size === sorted.length,
    `${label}只能覆盖连续的一段图层`,
  );
  return [start, end];
}

function readRange(raw, byId, count, label) {
  // Explicit member list.
  for (const key of MEMBER_KEYS) {
    const value = raw[key];
    if (Array.isArray(value) && value.length) {
      const indices = value.map(ref => asIndex(ref, byId, count, label));
      return contiguousRange(indices, label);
    }
  }
  // [start, end] tuple forms.
  for (const key of TUPLE_KEYS) {
    const value = raw[key];
    if (Array.isArray(value) && value.length === 2) {
      const start = asIndex(value[0], byId, count, label);
      const end = asIndex(value[1], byId, count, label);
      requireThat(start <= end, `${label}的起点不能晚于终点`);
      return [start, end];
    }
  }
  // Paired endpoint fields.
  const exclusive = raw.endExclusive === true || raw.toExclusive === true || raw.exclusive === true;
  for (const [aKey, bKey] of ENDPOINT_PAIRS) {
    if (raw[aKey] !== undefined && raw[bKey] !== undefined) {
      const start = asIndex(raw[aKey], byId, count, label);
      const rawEnd = raw[bKey];
      let end;
      // `end === count` is never a valid inclusive index, so accept it as a
      // slice-style exclusive sentinel under either index convention.
      if (typeof rawEnd === 'number' && Number.isInteger(rawEnd)
        && (rawEnd === count || (exclusive && rawEnd >= 0 && rawEnd < count + 1))) {
        end = rawEnd - 1;
      } else {
        end = asIndex(rawEnd, byId, count, label);
        if (exclusive) end -= 1;
      }
      requireThat(start <= end, `${label}的起点不能晚于终点`);
      return [start, end];
    }
  }
  // Single anchor plus count/length.
  const countValue = raw.count ?? raw.length ?? raw.span;
  const anchor = raw.start ?? raw.offset ?? raw.fromIndex ?? raw.begin;
  if (anchor !== undefined && countValue !== undefined && typeof countValue === 'number') {
    const start = asIndex(anchor, byId, count, label);
    requireThat(Number.isInteger(countValue) && countValue >= 1, `${label}的 count 须为正整数`);
    const end = start + countValue - 1;
    requireThat(end < count, `${label}的长度超出图层范围`);
    return [start, end];
  }
  return null;
}

function nestedAttrs(raw) {
  return {
    ...(isPlainObject(raw.style) ? raw.style : {}),
    ...(isPlainObject(raw.props) ? raw.props : {}),
    ...(isPlainObject(raw.appearance) ? raw.appearance : {}),
    ...raw,
  };
}

function normalizeBlend(raw, label) {
  const attrs = nestedAttrs(raw);
  const mode = attrs.blend ?? attrs.mode ?? attrs.blendMode ?? attrs.mixBlendMode ?? attrs.mix;
  if (mode === undefined) return 'normal';
  if (BLEND_MODES.includes(mode)) return mode;
  throw new InputError(`${label}的混合模式须为 normal、multiply 或 screen`);
}

function normalizeOpacity(raw, label) {
  const attrs = nestedAttrs(raw);
  const value = attrs.opacity ?? attrs.alpha ?? attrs.groupOpacity;
  if (value === undefined) return 1;
  requireThat(Number.isFinite(value) && value >= 0 && value <= 1, `${label}的不透明度须为 0–1`);
  return value;
}

function readExplicitParent(raw, ids) {
  for (const key of PARENT_KEYS) {
    const value = raw[key];
    if (value != null && typeof value !== 'object') return { id: String(value), key };
  }
  return null;
}

function readRank(raw) {
  for (const key of RANK_KEYS) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'number' && Number.isFinite(value)) return { value, key };
    if (typeof value === 'string') {
      const word = value.trim().toLowerCase();
      if (['inner', 'in', 'inside', 'child', 'deep', 'deeper', '内', '内层'].includes(word)) {
        return { keyword: 'inner', key };
      }
      if (['outer', 'out', 'outside', 'parent', 'shallow', '外', '外层'].includes(word)) {
        return { keyword: 'outer', key };
      }
      const numeric = Number(word);
      if (Number.isFinite(numeric)) return { value: numeric, key };
    }
  }
  return null;
}

function readKeywordSide(raw) {
  for (const key of ['nest', 'nested', 'position', 'placement', 'role', 'side', 'alignment']) {
    const value = raw[key];
    if (typeof value !== 'string') continue;
    const word = value.trim().toLowerCase();
    if (['inner', 'inside', 'in', 'child'].includes(word)) return 'inner';
    if (['outer', 'outside', 'out', 'parent'].includes(word)) return 'outer';
  }
  if (raw.inner === true || raw.isInner === true) return 'inner';
  if (raw.outer === true || raw.isOuter === true) return 'outer';
  return null;
}

function isParallelDeclared(raw) {
  for (const key of PARALLEL_KEYS) {
    if (raw[key] === true) return true;
  }
  if (typeof raw.relation === 'string' && /parallel|sibling|并列/i.test(raw.relation)) return true;
  if (typeof raw.nest === 'string' && /parallel|sibling|并列/i.test(raw.nest)) return true;
  return false;
}

// Main entry: inspect a document and resolve every group to an interval.
// `layers` are the normalized layer objects (id order = stack order).
export function analyzeGroups(input, layers) {
  const count = layers.length;
  const byId = new Map(layers.map((layer, index) => [layer.id, index]));
  const rawLayerRows = Array.isArray(input?.layers) ? input.layers : [];
  const { tags, inline, stacks } = collectLayerTags(rawLayerRows);

  const collection = findCollection(input);
  const entries = collectionEntries(collection);

  const descriptors = [];
  const seenIds = new Set();

  const ensureId = (raw, ordinal) => {
    if (raw.id != null) {
      const id = String(raw.id);
      requireThat(/^[a-zA-Z0-9][\w-]{0,31}$/.test(id), `组标识 ${id} 须为 1–32 位英数、下划线或连字符`);
      requireThat(!seenIds.has(id), `混色组标识 ${id} 不得重复`);
      seenIds.add(id);
      return id;
    }
    let id;
    do { id = `group-${ordinal + 1}-${seenIds.size}`; } while (seenIds.has(id));
    seenIds.add(id);
    return id;
  };

  // Groups declared in the top-level collection.
  entries.forEach(({ raw, ordinal, inheritedParent }) => {
    const label = groupLabel(raw, ordinal);
    objectLike(raw, label);
    const id = ensureId(raw, ordinal);
    const merged = inline.has(id) ? { ...inline.get(id), ...raw } : raw;
    let range = readRange(merged, byId, count, label);
    if (!range && tags.has(id)) range = contiguousRange([...tags.get(id)], label);
    descriptors.push({
      id, raw: merged, ordinal, range,
      opacity: normalizeOpacity(merged, label),
      blend: normalizeBlend(merged, label),
      explicitParent: inheritedParent ?? undefined,
      fromTag: false,
    });
  });

  // Groups only expressed through layer tags.
  let tagOrdinal = entries.length;
  for (const [id, indices] of tags) {
    if (seenIds.has(id)) continue;
    const raw = inline.get(id) ?? { id };
    const ordinal = tagOrdinal++;
    seenIds.add(id);
    descriptors.push({
      id, raw, ordinal,
      range: contiguousRange([...indices], groupLabel(raw, ordinal)),
      opacity: normalizeOpacity(raw, groupLabel(raw, ordinal)),
      blend: normalizeBlend(raw, groupLabel(raw, ordinal)),
      fromTag: true,
    });
  }

  // Ordered multi-membership tags (`groups:['outer','inner']`) explicitly
  // state the outer->inner chain for otherwise identical ranges.
  const descriptorById = new Map(descriptors.map(d => [d.id, d]));
  for (const stack of stacks) {
    for (let i = 1; i < stack.length; i++) {
      const child = descriptorById.get(stack[i]);
      const parent = descriptorById.get(stack[i - 1]);
      if (child && parent && child.explicitParent === undefined) {
        child.explicitParent = parent.id;
      }
    }
  }

  // A declared group without any resolvable range is malformed.
  for (const descriptor of descriptors) {
    if (!descriptor.range) {
      throw new InputError(`${groupLabel(descriptor.raw, descriptor.ordinal)}须用 from/to、start/end 或 layers 指定连续图层段`);
    }
    [descriptor.start, descriptor.end] = descriptor.range;
  }

  return descriptors;
}

function objectLike(value, label) {
  requireThat(isPlainObject(value), `${label}必须是对象`);
}

// Pairwise interval rules + explicit inner/outer resolution.
function resolveRelations(groups) {
  const ById = new Map(groups.map(g => [g.id, g]));

  // Validate explicit parent references point at known groups and contain.
  for (const g of groups) {
    const parentRef = readExplicitParent(g.raw);
    const parentId = parentRef?.id ?? g.explicitParent;
    if (parentId) {
      const parent = ById.get(String(parentId));
      requireThat(parent, `${groupLabel(g.raw, g.ordinal)}指向的外层组 ${parentId} 不存在`);
      requireThat(
        parent.start <= g.start && g.end <= parent.end,
        `${g.id} 的外层组 ${parent.id} 必须覆盖包含它的更大范围`,
      );
      g.explicitParent = parent.id;
    }
    // Inverse `inner: 'child-id'` references.
    for (const key of INNER_REF_KEYS) {
      const ref = g.raw[key];
      if (ref != null && typeof ref !== 'object') {
        const child = ById.get(String(ref));
        requireThat(child, `${g.id} 指向的内层组 ${ref} 不存在`);
        requireThat(g.start <= child.start && child.end <= g.end, `${g.id} 与内层组 ${child.id} 的范围不构成包含`);
        child.explicitParent = g.id;
      }
    }
    // Nested definition id lists.
    for (const key of CHILDREN_KEYS) {
      const list = g.raw[key];
      if (Array.isArray(list)) {
        for (const ref of list) {
          const id = typeof ref === 'object' ? ref?.id : ref;
          if (id == null) continue;
          const child = ById.get(String(id));
          requireThat(child, `${g.id} 包含的内层组 ${id} 不存在`);
          requireThat(g.start <= child.start && child.end <= g.end, `${g.id} 与内层组 ${child.id} 的范围不构成包含`);
          child.explicitParent = g.id;
        }
      }
    }
  }

  // Pairwise interval geometry.
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i], b = groups[j];
      const disjoint = a.end < b.start || b.end < a.start;
      if (disjoint) continue;
      const equal = a.start === b.start && a.end === b.end;
      if (equal) continue; // handled as equal-range sets below
      const aContainsB = a.start <= b.start && b.end <= a.end;
      const bContainsA = b.start <= a.start && a.end <= b.end;
      if (!aContainsB && !bContainsA) {
        throw new InputError(`混色组 ${a.id} 与 ${b.id} 的范围部分重叠又互不包含，须改为包含或错开的连续段`);
      }
    }
  }

  // Equal-range sets must be an explicitly ordered inner/outer chain.
  const equalSets = new Map();
  for (const g of groups) {
    const key = `${g.start}:${g.end}`;
    if (!equalSets.has(key)) equalSets.set(key, []);
    equalSets.get(key).push(g);
  }
  for (const set of equalSets.values()) {
    if (set.length < 2) continue;
    const parallel = set.some(g => isParallelDeclared(g.raw));
    requireThat(!parallel, `覆盖同一图层段的混色组不得并列：须明确 ${set.map(g => g.id).join('、')} 谁在内谁在外`);
    orderEqualSet(set);
  }

  // Resolve every group's parent: explicit link wins, otherwise the
  // tightest strict container from interval geometry.
  for (const g of groups) {
    if (g.explicitParent) {
      g.parent = g.explicitParent;
      continue;
    }
    if (g.equalParent) {
      g.parent = g.equalParent;
      continue;
    }
    const containers = groups.filter(h => h !== g
      && h.start <= g.start && g.end <= h.end
      && (h.start < g.start || h.end > g.end));
    // Tightest interval wins. For an equal-range outer/inner shell pair the
    // smaller group belongs to the innermost shell.
    const equalDepth = (h) => {
      let d = 0, cur = h;
      const guard = new Set();
      while (cur?.equalParent && !guard.has(cur.id)) { guard.add(cur.id); d++; cur = ById.get(cur.equalParent); }
      return d;
    };
    containers.sort((a, b) =>
      intervalSize(a) - intervalSize(b)
      || equalDepth(b) - equalDepth(a)
      || b.end - a.end
      || a.ordinal - b.ordinal);
    g.parent = containers[0]?.id ?? null;
  }

  // Cycle detection.
  for (const g of groups) {
    const seen = new Set();
    let current = g;
    while (current?.parent) {
      requireThat(!seen.has(current.id), `混色组嵌套关系在 ${current.id} 处形成环`);
      seen.add(current.id);
      current = ById.get(current.parent);
    }
  }

  // Depth (0 = outermost).
  const depthOf = (g) => {
    if (g.depthResolved !== undefined) return g.depthResolved;
    g.depthResolved = g.parent ? depthOf(ById.get(g.parent)) + 1 : 0;
    return g.depthResolved;
  };
  groups.forEach(depthOf);
}

function intervalSize(g) {
  return g.end - g.start + 1;
}

// Assign `equalParent` links for one same-range stack, outer -> inner.
function orderEqualSet(set) {
  const ids = new Set(set.map(g => g.id));

  // 1) Explicit relation edges inside the set.
  const outerToInner = new Map(); // outer id -> inner id
  const innerToOuter = new Map();
  const link = (outerId, innerId) => {
    if (!ids.has(outerId) || !ids.has(innerId) || outerId === innerId) return false;
    outerToInner.set(outerId, innerId);
    innerToOuter.set(innerId, outerId);
    return true;
  };
  for (const g of set) {
    if (g.explicitParent && ids.has(g.explicitParent)) link(g.explicitParent, g.id);
    const parentRef = readExplicitParent(g.raw);
    if (parentRef && ids.has(parentRef.id)) link(parentRef.id, g.id);
    for (const key of INNER_REF_KEYS) {
      const ref = g.raw[key];
      if (ref != null && typeof ref !== 'object' && ids.has(String(ref))) link(g.id, String(ref));
    }
    for (const key of CHILDREN_KEYS) {
      const list = g.raw[key];
      if (Array.isArray(list)) {
        for (const ref of list) {
          const id = typeof ref === 'object' ? ref?.id : ref;
          if (id != null && ids.has(String(id))) link(g.id, String(id));
        }
      }
    }
  }
  if (innerToOuter.size > 0 || outerToInner.size > 0) {
    // Walk from the unique outer root through single child links.
    const roots = set.filter(g => !innerToOuter.has(g.id));
    const chained = [];
    let current = roots.length === 1 ? roots[0] : undefined;
    const guard = new Set();
    while (current && !guard.has(current.id)) {
      guard.add(current.id);
      chained.push(current);
      const nextId = outerToInner.get(current.id);
      current = nextId ? set.find(g => g.id === nextId) : undefined;
    }
    if (chained.length === set.length) {
      for (let i = 1; i < chained.length; i++) chained[i].equalParent = chained[i - 1].id;
      return;
    }
    throw new InputError(`覆盖同一图层段的混色组 ${set.map(g => g.id).join('、')} 内外关系不明确：须给出唯一的 outer→inner 链`);
  }

  // 2) Distinct numeric ranks / keyword sides.
  const ranked = set.map((g) => {
    const rank = readRank(g.raw);
    const side = readKeywordSide(g.raw);
    return { g, rank, side };
  });

  // Explicit inner/outer keywords are enough for a pair.
  const sides = ranked.filter(r => r.side);
  if (set.length === 2 && sides.length >= 1) {
    let outer, inner;
    const markedInner = sides.find(r => r.side === 'inner');
    const markedOuter = sides.find(r => r.side === 'outer');
    if (markedInner && markedOuter && markedInner.g === markedOuter.g) {
      throw new InputError(`混色组 ${set.map(g => g.id).join('、')} 不能同时是内层和外层`);
    }
    if (markedInner && markedOuter && markedInner.g !== markedOuter.g) {
      inner = markedInner.g; outer = markedOuter.g;
    } else if (markedInner) {
      inner = markedInner.g; outer = set.find(g => g !== inner);
    } else if (markedOuter) {
      outer = markedOuter.g; inner = set.find(g => g !== outer);
    }
    if (outer && inner) {
      inner.equalParent = outer.id;
      return;
    }
  }

  // Numeric ordering: smaller rank = more outer, larger = more inner.
  const numeric = ranked.map(({ g, rank }) => ({ g, value: rank && typeof rank.value === 'number' ? rank.value : null }));
  if (numeric.every(r => r.value !== null)) {
    const values = numeric.map(r => r.value);
    if (new Set(values).size === values.length) {
      numeric.sort((a, b) => a.value - b.value);
      for (let i = 1; i < numeric.length; i++) numeric[i].g.equalParent = numeric[i - 1].g.id;
      return;
    }
    throw new InputError(`覆盖同一图层段的混色组 ${set.map(g => g.id).join('、')} 顺序值不得相同`);
  }

  // Document-level explicit ordering arrays.
  // (handled before analysis via applyDocumentOrder; nothing here)

  throw new InputError(`覆盖同一图层段的混色组 ${set.map(g => g.id).join('、')} 内外关系不明确：须用 parent、order/depth 或 inner/outer 明确嵌套顺序，不能按声明先后猜测`);
}

// Optional document-level ordering lists such as groupOrder:[outer,inner].
export function applyDocumentOrder(input, descriptors) {
  if (!isPlainObject(input)) return;
  const keys = ['groupOrder', 'groupOrdering', 'groupsOrder', 'nestOrder', 'groupNesting', 'nesting', 'order', 'stack'];
  for (const key of keys) {
    const value = input[key];
    if (Array.isArray(value) && value.every(v => typeof v === 'string' || typeof v === 'number' || Array.isArray(v))) {
      const byId = new Map(descriptors.map(d => [d.id, d]));
      const stacks = value.every(Array.isArray) ? value : [value];
      for (const stack of stacks) {
        const ids = stack.map(v => String(typeof v === 'object' && v !== null ? v.id : v));
        for (let i = 1; i < ids.length; i++) {
          const child = byId.get(ids[i]);
          const parent = byId.get(ids[i - 1]);
          if (child && parent && parent.start <= child.start && child.end <= parent.end) {
            child.explicitParent = parent.id;
          }
        }
      }
    }
  }
}

// Build open/close event lists indexed by layer position for raster sweep.
export function buildPlan(input, layers) {
  const groups = analyzeGroups(input, layers);
  applyDocumentOrder(input, groups);
  // Re-run relation resolution because document order may add parent links.
  resolveRelations(groups);
  const count = layers.length;
  const openAt = Array.from({ length: count }, () => []);
  const closeAt = Array.from({ length: count }, () => []);
  // Bucket by endpoint, then order purely by interval containment:
  // opening runs outer -> inner, closing runs inner -> outer. Resolved
  // depth breaks equal-range ties using the explicit inner/outer order.
  for (const g of groups) openAt[g.start].push(g);
  for (const g of groups) closeAt[g.end].push(g);
  for (let i = 0; i < count; i++) {
    openAt[i].sort((a, b) =>
      b.end - a.end
      || (a.depthResolved ?? 0) - (b.depthResolved ?? 0)
      || a.ordinal - b.ordinal);
    closeAt[i].sort((a, b) =>
      b.start - a.start
      || (b.depthResolved ?? 0) - (a.depthResolved ?? 0)
      || b.ordinal - a.ordinal);
  }

  // Sanity: every group must have emitted balanced events.
  for (const g of groups) {
    requireThat(openAt[g.start].includes(g) && closeAt[g.end].includes(g), `混色组 ${g.id} 的合成计划无效`);
  }
  return { openAt, closeAt, groups };
}

// Plain JSON representation stored in frozen documents. Never clobbers a
// field the source draft already provided.
export function toPersisted(descriptor, layers) {
  const out = { ...descriptor.raw };
  // Flatten nested group-definition objects into id references; the group
  // collection stored on the document is a flat array plus `parent` links.
  for (const key of new Set([...NESTED_OBJECT_KEYS, ...CHILDREN_KEYS])) {
    if (Array.isArray(out[key])) {
      out[key] = out[key]
        .map(item => (isPlainObject(item) ? (item.id ?? null) : item))
        .filter(item => item != null);
    }
  }
  out.id = descriptor.id;
  if (out.opacity === undefined && out.alpha === undefined) out.opacity = descriptor.opacity;
  if (out.blend === undefined && out.mode === undefined && out.blendMode === undefined) out.blend = descriptor.blend;
  if (out.start === undefined && out.startIndex === undefined) out.start = descriptor.start;
  if (out.end === undefined && out.endIndex === undefined) out.end = descriptor.end;
  if (out.from === undefined) out.from = layers[descriptor.start]?.id;
  if (out.to === undefined) out.to = layers[descriptor.end]?.id;
  if (out.layers === undefined && out.layerIds === undefined && out.members === undefined) {
    out.layers = layers.slice(descriptor.start, descriptor.end + 1).map(l => l.id);
  }
  // Always expose the resolved outer-group id under the canonical name,
  // while any source alias (outer/parentId/...) remains untouched above.
  out.parent = descriptor.parent ?? null;
  if (out.depth === undefined) out.depth = descriptor.depthResolved ?? 0;
  return out;
}

// Convenience used by document normalization.
export function normalizeGroupDraft(input, layers) {
  const descriptors = analyzeGroups(input, layers);
  applyDocumentOrder(input, descriptors);
  resolveRelations(descriptors);
  if (!descriptors.length) return undefined;
  return descriptors.map(d => toPersisted(d, layers));
}

// Accept the alternative "wrapper layer" syntax in which group rows carry a
// nested `layers`/`children` array. Real leaf layers are flattened into the
// stack and each wrapper becomes a range group over its leaf indices.
export function expandLayerWrappers(input) {
  if (!isPlainObject(input) || !Array.isArray(input.layers)) return input;
  const flat = [];
  const wrappers = [];
  let wrapperCount = 0;
  const walk = (rows, structuralParent) => {
    for (const row of rows) {
      const childRows = isPlainObject(row) && !row.shape && (
        Array.isArray(row.layers) ? row.layers : Array.isArray(row.children) ? row.children : null);
      if (childRows) {
        const start = flat.length;
        const wrapperId = row.id != null ? String(row.id) : `wrapper-${++wrapperCount}`;
        walk(childRows, wrapperId);
        const end = flat.length - 1;
        const { layers: _l, children: _c, ...attrs } = row;
        wrappers.push({
          ...attrs,
          id: wrapperId,
          start,
          end,
          ...(structuralParent ? { parent: attrs.parent ?? structuralParent } : {}),
        });
      } else {
        // Keep non-wrapper rows (including malformed primitives) so the
        // ordinary layer validation rejects them.
        flat.push(row);
      }
    }
  };
  walk(input.layers, undefined);
  if (!wrappers.length) return input;
  let groups;
  if (Array.isArray(input.groups)) groups = [...input.groups, ...wrappers];
  else if (isPlainObject(input.groups)) groups = { ...input.groups };
  else groups = [...wrappers];
  if (!Array.isArray(groups)) for (const w of wrappers) groups[w.id] = w;
  return { ...input, layers: flat, groups };
}

// Direct-validation convenience mirroring validateMaskOrder(layers).
// Accepts either validateGroups(normalizedLayers, rawGroups) or
// validateGroups(documentLike). Throws InputError on illegal nesting.
export function validateGroups(layersOrDocument, maybeGroups) {
  let layers = layersOrDocument;
  let source = {};
  if (!Array.isArray(layersOrDocument) && isPlainObject(layersOrDocument)) {
    const documentLike = layersOrDocument;
    layers = documentLike.layers;
    source = documentLike;
  } else if (maybeGroups !== undefined) {
    source = { groups: maybeGroups };
  }
  requireThat(Array.isArray(layers), 'validateGroups 需要图层数组或文档对象');
  const descriptors = analyzeGroups(source, layers);
  applyDocumentOrder(source, descriptors);
  resolveRelations(descriptors);
  return descriptors;
}
