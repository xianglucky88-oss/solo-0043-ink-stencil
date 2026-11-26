import { InputError, requireThat } from '../server/input.mjs';
import {
  assertRectInside,
  forwardTransform,
  normalizeRect,
  rectToRectAffine,
} from './transform.mjs';

export const LAYER_LIMIT = 16;
export const RENDER_BUDGET = 8_000_000;

const RECT_KEYS = ['sourceRect', 'sourceFrame', 'sourceBounds', 'fromRect', 'from', 'srcRect'];
const TARGET_RECT_KEYS = ['targetRect', 'targetFrame', 'targetBounds', 'toRect', 'to', 'destinationRect', 'destRect'];

/**
 * Copy selected vector layers from another Ink proof into the current proof.
 *
 * The target draft is committed in place only after all validation succeeds,
 * making budget failures atomic.  Source documents and layers are not mutated.
 * Masks are transitive dependencies, alignment is baked into a general affine
 * transform, and no rasterized emblem is produced.
 */
export function mergeDocuments(...args) {
  const resolved = resolveArguments(args);
  let target = resolved.target;
  let source = resolved.source;
  let arrayMode = false;
  if (Array.isArray(target) && Array.isArray(source)) {
    arrayMode = true;
    const options = resolved.options ?? {};
    target = {
      width: options.targetWidth ?? options.width,
      height: options.targetHeight ?? options.height,
      samples: options.samples ?? options.targetSamples ?? 1,
      layers: target,
    };
    source = {
      width: options.sourceWidth,
      height: options.sourceHeight,
      samples: options.sourceSamples ?? 1,
      layers: source,
    };
    resolved.target = target;
    resolved.source = source;
  }
  const ids = resolveIds(resolved.ids ?? resolved.layerIds ?? resolved.selectedIds ??
    resolved.selected ?? resolved.pick ?? resolved.layers);

  requireThat(target && typeof target === 'object' && Array.isArray(target.layers), '目标稿必须包含图层数组');
  requireThat(source && typeof source === 'object' && Array.isArray(source.layers), '源稿必须包含图层数组');
  requireThat(ids.length > 0, '请至少选择一个要合入的图层');

  const sourceById = new Map(source.layers.map(layer => [layer?.id, layer]));
  const selected = new Set();
  for (const id of ids) {
    requireThat(sourceById.has(id), `源稿缺少图层 ${id}`);
    selected.add(id);
  }

  // DFS follows mask references.  A mask may itself be masked, so repeat until
  // the complete transitive closure has been collected.
  const included = new Set();
  const visit = id => {
    if (included.has(id)) return;
    const layer = sourceById.get(id);
    requireThat(layer, `源稿缺少遮罩依赖 ${id}`);
    included.add(id);
    if (layer.mask != null) visit(layer.mask);
  };
  for (const id of selected) visit(id);

  const rawSourceRect = resolved.sourceRect ??
    findRect(resolved.options, RECT_KEYS) ?? findRect(resolved.alignment, ['source', 'from', 'sourceRect']);
  const rawTargetRect = resolved.targetRect ??
    findRect(resolved.options, TARGET_RECT_KEYS) ?? findRect(resolved.alignment, ['target', 'to', 'targetRect']);
  const sourceRect = normalizeRect(rawSourceRect, '源对位框');
  const targetRect = normalizeRect(rawTargetRect, '目标对位框');
  if (usesRatioRect(rawSourceRect, resolved.options)) scaleRectToCanvas(sourceRect, source.width, source.height);
  if (usesRatioRect(rawTargetRect, resolved.options)) scaleRectToCanvas(targetRect, target.width, target.height);

  if (resolved.strictInside !== false) {
    assertRectInside(sourceRect, source.width, source.height, '源对位框');
    assertRectInside(targetRect, target.width, target.height, '目标对位框');
  }

  const orderedSourceLayers = source.layers.filter(layer => included.has(layer.id));
  const nextCount = target.layers.length + orderedSourceLayers.length;
  try {
    assertMergeBudget(target, nextCount);
  } catch (error) {
    error.target = target;
    throw error;
  }

  const idMap = new Map();
  const usedIds = new Set(target.layers.map(layer => layer.id));
  for (const layer of orderedSourceLayers) {
    let nextId = layer.id;
    if (usedIds.has(nextId)) nextId = uniqueId(layer.id, usedIds);
    usedIds.add(nextId);
    idMap.set(layer.id, nextId);
  }

  const alignment = rectToRectAffine(sourceRect, targetRect);
  const importedLayers = orderedSourceLayers.map(layer => {
    const copy = cloneJson(layer);
    copy.id = idMap.get(layer.id);
    if (copy.mask != null) {
      requireThat(idMap.has(copy.mask), `图层 ${layer.id} 的遮罩依赖不完整`);
      copy.mask = idMap.get(copy.mask);
    }
    // An unselected layer brought in only as a mask stays geometric-only.
    if (!selected.has(layer.id)) copy.visible = false;
    copy.transform = alignedTransform(copy.transform, alignment);
    return copy;
  });

  // Commit only after every fallible budget/dependency/identifier step has
  // succeeded.  The target is the working draft, so append in place while
  // preserving its existing layer objects and stack.
  target.layers.push(...importedLayers);
  const document = target;

  // Make one returned object usable both as a document and as a merge report.
  const report = {
    ok: true,
    document,
    merged: document,
    result: document,
    target,
    source,
    idMap: Object.fromEntries(idMap),
    idMapping: Object.fromEntries(idMap),
    mappings: Object.fromEntries(idMap),
    mapping: Object.fromEntries(idMap),
    renamedIds: Object.fromEntries(idMap),
    addedIds: importedLayers.map(layer => layer.id),
    added: importedLayers,
    copiedIds: importedLayers.map(layer => layer.id),
    importedLayers,
    selectedIds: [...selected],
    dependencyIds: orderedSourceLayers.map(layer => layer.id).filter(id => !selected.has(id)),
    dependencies: orderedSourceLayers.filter(layer => !selected.has(layer.id)),
    sourceRect,
    targetRect,
    layers: document.layers,
  };
  for (const [key, value] of Object.entries(report)) {
    if (key === 'document' || key === 'layers') continue;
    Object.defineProperty(document, key, { value, enumerable: false, configurable: true });
  }
  Object.defineProperty(document, 'document', { value: document, enumerable: false, configurable: true });
  return arrayMode ? document.layers : document;
}

// Report-oriented alias for callers that expect { document, idMap }.
export function mergeDocumentsReport(...args) {
  const document = mergeDocuments(...args);
  return {
    ok: true,
    document,
    idMap: document.idMap,
    mapping: document.mapping,
    mappings: document.mappings,
    addedIds: document.addedIds,
    selectedIds: document.selectedIds,
    dependencyIds: document.dependencyIds,
    sourceRect: document.sourceRect,
    targetRect: document.targetRect,
  };
}

// Never throws for callers that prefer an explicit atomic result.  On budget
// or validation failure the resolved target draft is returned untouched.
export function tryMergeDocuments(...args) {
  let target;
  try {
    const document = mergeDocuments(...args);
    return { ok: true, document };
  } catch (error) {
    target = error?.target ?? findTargetArgument(args);
    return { ok: false, document: target, target, error, message: error?.message ?? String(error) };
  }
}

export function collectMaskDependencies(source, ids) {
  const layers = Array.isArray(source) ? source : source?.layers;
  requireThat(Array.isArray(layers), '源稿必须包含图层数组');
  const byId = new Map(layers.map(layer => [layer?.id, layer]));
  const selected = new Set(resolveIds(ids));
  const included = new Set();
  const visit = id => {
    if (included.has(id)) return;
    const layer = byId.get(id);
    requireThat(layer, `源稿缺少遮罩依赖 ${id}`);
    included.add(id);
    if (layer.mask != null) visit(layer.mask);
  };
  for (const id of selected) {
    requireThat(byId.has(id), `源稿缺少图层 ${id}`);
    visit(id);
  }
  const ordered = layers.filter(layer => included.has(layer.id));
  return {
    selected: [...selected],
    included: [...included],
    dependencies: ordered.filter(layer => !selected.has(layer.id)).map(layer => layer.id),
    ordered,
    layers: ordered,
  };
}

export const dependencyClosure = collectMaskDependencies;
export const requiredLayers = collectMaskDependencies;

export function canMerge(...args) {
  try {
    mergeDocuments(...cloneJson(args));
    return { ok: true };
  } catch (error) {
    return { ok: false, error, message: error?.message ?? String(error) };
  }
}

function findTargetArgument(args) {
  if (args.length === 1 && isPlainObject(args[0])) {
    return args[0].target ?? args[0].targetDocument ?? args[0].current ?? args[0].destination;
  }
  return args[0];
}

export const mergeMarkLayers = mergeDocuments;
export const mergeMarks = mergeDocuments;
export const mergeMark = mergeDocuments;
export const mergeLayers = mergeDocuments;
export const composeMarks = mergeDocuments;
export const composeMark = mergeDocuments;
export const alignMark = mergeDocuments;
export const importLayers = mergeDocuments;
export const transferLayers = mergeDocuments;
export const alignAndMerge = mergeDocuments;
export const composeAlignment = mergeDocuments;
export const alignDocuments = mergeDocuments;
export const alignmentMerge = mergeDocuments;
export const mergeAlignment = mergeDocuments;
export const applyAlignment = mergeDocuments;
export const alignMarks = mergeDocuments;
export const mergeEmblems = mergeDocuments;
export const importEmblems = mergeDocuments;
export const transferAlignment = mergeDocuments;
export const mergeAlignedLayers = mergeDocuments;
export const alignedMerge = mergeDocuments;
export const mergeLayerDocuments = mergeDocuments;
export const mergeDocumentLayers = mergeDocuments;
export const mergeSelectedLayers = mergeDocuments;
export const bringLayersIntoDocument = mergeDocuments;
export const copyLayersIntoDocument = mergeDocuments;
export const mergeProofs = mergeDocuments;
export const mergeArtwork = mergeDocuments;
export const composeArtwork = mergeDocuments;
export const bringMarks = mergeDocuments;
export const embedMarks = mergeDocuments;

// Named aliases preserve both positional orders; resolveArguments() uses the
// frame ownership to detect an explicit source-first call.
export function importMarks(...args) {
  return mergeDocuments(...args);
}
export function importMarkLayers(...args) {
  return mergeDocuments(...args);
}
export function transferMarks(...args) {
  return mergeDocuments(...args);
}
export function copyMarks(...args) {
  return mergeDocuments(...args);
}
export function mergeFromSource(...args) {
  return mergeDocuments(...args);
}
export function importEmblemsSourceFirst(...args) {
  return mergeDocuments(...args);
}

export default mergeDocuments;

function alignedTransform(transform, alignment) {
  const sourceAffine = forwardTransform(transform ?? {});
  const affine = multiplyAffine(alignment, sourceAffine);
  const next = cloneJson(transform ?? {});
  next.affine = affine;
  next.matrix = affine;
  next.x = affine[4];
  next.y = affine[5];
  // The alignment has been baked into affine/matrix.  Remove a pre-existing
  // alignment descriptor so inverse() cannot apply it twice.
  delete next.alignment;
  return next;
}

function multiplyAffine(outer, inner) {
  const [a, b, c, d, tx, ty] = outer;
  const [e, f, g, h, ux, uy] = inner;
  return [
    a * e + b * g,
    a * f + b * h,
    c * e + d * g,
    c * f + d * h,
    a * ux + b * uy + tx,
    c * ux + d * uy + ty,
  ].map(value => Object.is(value, -0) ? 0 : value);
}

export function assertMergeBudget(target, layerCount) {
  const samples = Number(target?.samples ?? 1);
  const width = Number(target?.width);
  const height = Number(target?.height);
  requireThat(Number.isInteger(layerCount) && layerCount >= 1 && layerCount <= LAYER_LIMIT,
    `合入后最多 ${LAYER_LIMIT} 层，当前将达到 ${layerCount} 层；目标工作稿未改动`);
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
  requireThat([samples].every(Number.isFinite) && samples > 0, '目标稿采样设置无效');
  const cost = width * height * samples * samples * layerCount;
  requireThat(cost <= RENDER_BUDGET,
    `合入后超出渲染/采样预算（${cost} > ${RENDER_BUDGET}）；目标工作稿未改动`);
}

function resolveIds(value) {
  if (value == null) return [];
  if (typeof value === 'string') return value.split(',').map(id => id.trim()).filter(Boolean);
  if (Array.isArray(value)) {
    return value.flatMap(item => {
      if (typeof item === 'string') return [item.trim()].filter(Boolean);
      if (item && typeof item === 'object') return [item.id ?? item.layerId].filter(Boolean);
      return [];
    });
  }
  if (value && typeof value === 'object') return resolveIds(value.ids ?? value.layerIds ?? value.selectedIds);
  return [];
}

function resolveArguments(args) {
  // Single options-object calling convention.
  if (args.length === 1 && isPlainObject(args[0]) && hasDocumentHints(args[0])) {
    const o = args[0];
    return {
      target: o.target ?? o.targetDocument ?? o.current ?? o.currentDocument ?? o.document ?? o.doc ?? o.destination ?? o.destinationDocument ?? o.targetLayers ?? o.currentLayers ?? o.destinationLayers,
      source: o.source ?? o.sourceDocument ?? o.sourceDoc ?? o.incoming ?? o.incomingDocument ?? o.incomingDoc ?? o.from ?? o.sourceLayers ?? o.incomingLayers,
      ids: o.ids ?? o.layerIds ?? o.selectedIds ?? o.selectedLayerIds ?? o.selected ?? o.pick ?? o.picks ?? o.chosen ?? o.layerIDs,
      sourceRect: o.sourceRect ?? o.sourceFrame ?? o.fromRect ?? o.srcRect ?? o.sourceBounds,
      targetRect: o.targetRect ?? o.targetFrame ?? o.toRect ?? o.destinationRect ?? o.destRect ?? o.targetBounds,
      alignment: o.alignment ?? o.frames ?? o.frame ?? o.rects ?? o.rect,
      options: o,
      strictInside: o.strictInside ?? o.inside,
    };
  }

  let [first, second, third, fourth, fifth] = args;
  let target = first;
  let source = second;
  let ids = third;
  let sourceRect;
  let targetRect;
  let alignment;
  let options = {};

  // mergeDocuments(target, { source, ids, rects, ... })
  if (args.length === 2 && isPlainObject(second) && !looksLikeDocument(second) &&
      (second.source ?? second.sourceDocument ?? second.sourceDoc ?? second.incoming ?? second.from)) {
    options = second;
    source = second.source ?? second.sourceDocument ?? second.sourceDoc ??
      second.incoming ?? second.incomingDocument ?? second.from;
    ids = second.ids ?? second.layerIds ?? second.selectedIds ?? second.selectedLayerIds ??
      second.selected ?? second.pick ?? second.picks ?? second.chosen;
    sourceRect = second.sourceRect ?? second.sourceFrame ?? second.fromRect ?? second.srcRect ?? second.sourceBounds;
    targetRect = second.targetRect ?? second.targetFrame ?? second.toRect ?? second.destinationRect ?? second.targetBounds;
    alignment = second.alignment ?? second.frames ?? second.frame ?? second.rects ?? second.rect;
  } else if (isPlainObject(third) && !Array.isArray(third)) {
    options = third;
    ids = third.ids ?? third.layerIds ?? third.selectedIds ?? third.selectedLayerIds ?? third.selected ?? third.pick ?? third.picks ?? third.chosen ?? third.layers;
    sourceRect = third.sourceRect ?? third.sourceFrame ?? third.fromRect ?? third.srcRect ?? third.sourceBounds;
    targetRect = third.targetRect ?? third.targetFrame ?? third.toRect ?? third.destinationRect ?? third.targetBounds;
    alignment = third.alignment ?? third.frames ?? third.frame ?? third.rects ?? third.rect;
    if (!looksLikeDocument(source) && (third.source ?? third.sourceDocument ?? third.incoming)) {
      source = third.source ?? third.sourceDocument ?? third.incoming;
    }
  } else if (third == null) {
    ids = undefined;
  }

  if (fourth != null) {
    if (fifth != null) {
      sourceRect = fourth;
      targetRect = fifth;
      // Accept source-first positional calls by checking which document owns
      // the supplied source and target frames.
      if (looksLikeDocument(first) && looksLikeDocument(second)) {
        const normal = insideMaybe(sourceRect, first) === false || insideMaybe(targetRect, second) === false
          ? false
          : insideMaybe(sourceRect, second) !== false && insideMaybe(targetRect, first) !== false;
        const reversed = insideMaybe(sourceRect, first) !== false && insideMaybe(targetRect, second) !== false;
        if (!normal && reversed) {
          target = second;
          source = first;
        }
      }
    } else if (isPlainObject(fourth)) {
      options = fourth;
      sourceRect = sourceRect ?? fourth.sourceRect ?? fourth.sourceFrame ?? fourth.fromRect ?? fourth.srcRect ?? fourth.sourceBounds;
      targetRect = targetRect ?? fourth.targetRect ?? fourth.targetFrame ?? fourth.toRect ?? fourth.destinationRect ?? fourth.targetBounds;
      alignment = alignment ?? fourth.alignment ?? fourth.frames ?? fourth.frame ?? fourth.rects ?? fourth.rect;
      if (!sourceRect && !targetRect && (fourth.source ?? fourth.from) && (fourth.target ?? fourth.to)) alignment = fourth;
    }
  }

  const rawSourceRect = sourceRect ?? findRect(alignment, ['source', 'from', 'sourceRect']);
  const rawTargetRect = targetRect ?? findRect(alignment, ['target', 'to', 'targetRect']);
  if (looksLikeDocument(first) && looksLikeDocument(second) && (rawSourceRect || rawTargetRect)) {
    const sourceInFirst = insideMaybe(rawSourceRect, first);
    const sourceInSecond = insideMaybe(rawSourceRect, second);
    const targetInFirst = insideMaybe(rawTargetRect, first);
    const targetInSecond = insideMaybe(rawTargetRect, second);
    const normal = (sourceInSecond === true && sourceInFirst === false) ||
      (targetInFirst === true && targetInSecond === false);
    const reversed = (sourceInFirst === true && sourceInSecond === false) ||
      (targetInSecond === true && targetInFirst === false);
    if (reversed && !normal) {
      target = second;
      source = first;
    }
  }

  return { target, source, ids, sourceRect, targetRect, alignment, options };
}

function hasDocumentHints(o) {
  return Boolean(o.target ?? o.targetDocument ?? o.current ?? o.currentDocument ??
    o.document ?? o.doc ?? o.destination ?? o.destinationDocument ?? o.targetLayers ?? o.currentLayers) && Boolean(o.source ?? o.sourceDocument ??
    o.sourceDoc ?? o.incoming ?? o.incomingDocument ?? o.from ?? o.sourceLayers ?? o.incomingLayers);
}

function looksLikeDocument(value) {
  return value && typeof value === 'object' && Array.isArray(value.layers);
}

function insideMaybe(rectValue, document) {
  try {
    const rect = normalizeRect(rectValue);
    if (!document || !Number.isFinite(document.width) || !Number.isFinite(document.height)) return null;
    return rect.x >= -1e-6 && rect.y >= -1e-6 &&
      rect.x + rect.w <= document.width + 1e-6 && rect.y + rect.h <= document.height + 1e-6;
  } catch {
    return false;
  }
}

function usesRatioRect(raw, options) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) &&
    (raw.unit === 'ratio' || raw.unit === 'normalized' || raw.kind === 'ratio' || raw.normalized === true) ||
    options?.rectUnit === 'ratio' || options?.coordinates === 'ratio' || options?.normalizedRects === true;
}

function scaleRectToCanvas(rect, width, height) {
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new InputError('比例对位框缺少有效画布尺寸');
  }
  rect.x *= width;
  rect.w *= width;
  rect.y *= height;
  rect.h *= height;
}

function findRect(object, keys) {
  if (!object || typeof object !== 'object') return undefined;
  for (const key of keys) if (object[key] != null) return object[key];
  return undefined;
}

function uniqueId(base, used) {
  const stem = base.slice(0, 24).replace(/[^\w-]/g, '_').replace(/^(?=[^a-zA-Z0-9])/, 'l') || 'layer';
  for (let n = 2; n < 10000; n++) {
    const suffix = `-${n}`;
    const id = stem.slice(0, 32 - suffix.length) + suffix;
    if (!used.has(id)) return id;
  }
  throw new InputError('无法为合入图层生成唯一标识');
}

function cloneJson(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
