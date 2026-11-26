import { requireThat, InputError, number } from '../server/input.mjs';
import { raster } from './raster.mjs';
import { png } from './png.mjs';
import { encodeAPNG } from './apng.mjs';
import { normalize } from './document.mjs';

// One existing proof's render budget (see product/document.mjs). The loop is
// charged for every frame using width*height*samples^2*layers, summed.
export const RENDER_BUDGET = 8_000_000;
export const LOOP_END_MAX = 10_000;

const ARRANGEMENT_KEYS = [
  'animation', 'anim', 'apng', 'timeline', 'schedule', 'motion', 'reveal',
  'unveil', 'sequence', 'timeframe', 'frames', 'keyframes', 'cells', 'cels',
];
const FRAME_LIST_KEYS = ['frames', 'keyframes', 'keys', 'cells', 'cels', 'steps', 'tracks'];
const TIME_KEYS = ['at', 'start', 'time', 'startTime', 'startAt', 'offset', 'begin', 'from', 'when', 't', 'ms', 'timeMs'];
const HOLD_KEYS = ['hold', 'delay', 'duration', 'stay', 'wait', 'frameDuration', 'holdMs'];
const END_KEYS = [
  'end', 'endAt', 'endTime', 'endMs', 'finish', 'finishAt', 'loopEnd', 'cycleEnd',
  'totalDuration', 'totalTime', 'duration', 'length', 'total', 'span', 'period', 'until',
];
const CHANGE_KEYS = ['layers', 'changes', 'updates', 'edits', 'properties', 'props', 'targets', 'values', 'set', 'tracks'];
const TARGET_KEYS = ['layer', 'target', 'layerId', 'ref', 'name'];
const POSITION_KEYS = ['position', 'pos', 'center', 'location', 'translate', 'translation'];

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function frameLike(value) {
  if (!isPlainObject(value)) return false;
  return TIME_KEYS.some(key => hasOwn(value, key))
    || HOLD_KEYS.some(key => hasOwn(value, key))
    || CHANGE_KEYS.some(key => hasOwn(value, key))
    || TARGET_KEYS.some(key => hasOwn(value, key));
}

function looksLikeArrangement(value) {
  if (Array.isArray(value)) return value.some(frameLike);
  if (!isPlainObject(value)) return false;
  const listKey = FRAME_LIST_KEYS.find(key => Array.isArray(value[key]));
  return Boolean(listKey) && value[listKey].some(frameLike);
}

// Finds the frame arrangement under any conventional key, or by object shape.
// Returns null for an ordinary single-proof document.
export function extractScheduleInput(input) {
  if (!isPlainObject(input)) return null;
  for (const key of ARRANGEMENT_KEYS) {
    if (!hasOwn(input, key) || input[key] == null) continue;
    const value = input[key];
    if (Array.isArray(value)) return { raw: { frames: value }, sibling: input };
    if (isPlainObject(value)) return { raw: value, sibling: input };
    throw new InputError(`帧安排字段 ${key} 必须是对象或帧数组`);
  }
  // Shape fallback: an unknown container key holding {frames:[...]} plus timing.
  for (const [key, value] of Object.entries(input)) {
    if (key === 'layers') continue;
    if (looksLikeArrangement(value) && (END_KEYS.some(k => hasOwn(value, k)) || FRAME_LIST_KEYS.some(k => hasOwn(value, k)))) {
      return { raw: value, sibling: input };
    }
  }
  // Top-level timing alongside a top-level frames array key already handled above,
  // but cover a bare {steps:[...]} with sibling duration.
  const listKey = FRAME_LIST_KEYS.find(key => Array.isArray(input[key]) && input[key].some(frameLike));
  if (listKey) return { raw: { frames: input[listKey] }, sibling: input };
  // Last-resort: any non-layer top-level array of frame-like objects under an
  // unknown key (e.g. states/moments/cues). Timing/end read from siblings.
  for (const [key, value] of Object.entries(input)) {
    if (key === 'layers' || ARRANGEMENT_KEYS.includes(key)) continue;
    if (Array.isArray(value) && value.length > 0 && value.some(frameLike)) {
      return { raw: { frames: value }, sibling: input };
    }
    if (isPlainObject(value) && looksLikeArrangement(value)) {
      return { raw: value, sibling: input };
    }
  }
  return null;
}

function readInteger(source, keys, label) {
  for (const key of keys) {
    if (hasOwn(source, key) && source[key] !== undefined && source[key] !== null) {
      return number(source[key], 0, LOOP_END_MAX, label, true);
    }
  }
  return undefined;
}

function readProps(bag) {
  const props = {};
  if (typeof bag === 'number') {
    if (Number.isFinite(bag)) props.opacity = bag;
    return props;
  }
  if (Array.isArray(bag)) {
    if (bag.length >= 2 && Number.isFinite(bag[0]) && Number.isFinite(bag[1])) {
      props.x = bag[0]; props.y = bag[1];
    }
    return props;
  }
  if (!isPlainObject(bag)) return props;
  const opacity = bag.opacity ?? bag.alpha;
  if (opacity !== undefined && opacity !== null) props.opacity = opacity;
  if (bag.x !== undefined && bag.x !== null) props.x = bag.x;
  if (bag.y !== undefined && bag.y !== null) props.y = bag.y;
  for (const key of POSITION_KEYS) {
    const position = bag[key];
    if (Array.isArray(position) && position.length >= 2) {
      if (props.x === undefined && Number.isFinite(position[0])) props.x = position[0];
      if (props.y === undefined && Number.isFinite(position[1])) props.y = position[1];
    } else if (isPlainObject(position)) {
      if (props.x === undefined && position.x !== undefined) props.x = position.x;
      if (props.y === undefined && position.y !== undefined) props.y = position.y;
    }
  }
  if (isPlainObject(bag.transform)) {
    if (props.x === undefined && bag.transform.x !== undefined) props.x = bag.transform.x;
    if (props.y === undefined && bag.transform.y !== undefined) props.y = bag.transform.y;
  }
  if (Array.isArray(bag.transform) && bag.transform.length >= 2) {
    if (props.x === undefined) props.x = bag.transform[0];
    if (props.y === undefined) props.y = bag.transform[1];
  }
  return props;
}

function validateProps(rawProps, layerId) {
  const props = {};
  if (rawProps.opacity !== undefined) {
    props.opacity = number(rawProps.opacity, 0, 1, `图层 ${layerId} 的不透明度`);
  }
  if (rawProps.x !== undefined) props.x = number(rawProps.x, -768, 768, `图层 ${layerId} 的 X 位置`);
  if (rawProps.y !== undefined) props.y = number(rawProps.y, -768, 768, `图层 ${layerId} 的 Y 位置`);
  return props;
}

// Strictly validates and canonicalises the frame arrangement. All layer
// references, timings and the whole-loop budget are checked here so a bad
// request fails before any artifact bytes are produced. Accepts a whole raw
// working document or a bare `{ frames, end }` container.
export function normalizeSchedule(input, context = {}) {
  const extraction = extractScheduleInput(input)
    ?? (isPlainObject(input) && (Array.isArray(input.frames) || FRAME_LIST_KEYS.some(k => Array.isArray(input[k])))
      ? { raw: input, sibling: context.sibling ?? {} }
      : null);
  requireThat(extraction, '工作稿没有有效的帧安排');
  const { raw } = extraction;
  const sibling = { ...(context.sibling ?? {}), ...extraction.sibling };

  let listKey = FRAME_LIST_KEYS.find(key => Array.isArray(raw[key]) && raw[key].some(frameLike));
  if (!listKey) listKey = FRAME_LIST_KEYS.find(key => Array.isArray(raw[key]));
  let rawFrames = Array.isArray(raw) ? raw : (listKey ? raw[listKey] : null);
  // Any nested array of frame-like objects under an unusual list key.
  if ((!Array.isArray(rawFrames) || !rawFrames.length) && isPlainObject(raw)) {
    for (const value of Object.values(raw)) {
      if (Array.isArray(value) && value.length && value.some(frameLike)) { rawFrames = value; break; }
    }
  }
  requireThat(Array.isArray(rawFrames) && rawFrames.length >= 1, '帧安排至少需要一帧');

  const contextLayers = context.layers ?? (Array.isArray(input?.layers) ? input.layers : []);
  const layerIds = new Set(contextLayers.map(layer => layer.id));
  const changesPerFrame = [];

  const addChange = (changes, targetId, bag, { strictReference = true } = {}) => {
    if (targetId == null) return;
    requireThat(typeof targetId === 'string', '帧改动的图层标识必须是字符串');
    if (!layerIds.has(targetId)) {
      if (strictReference) throw new InputError(`帧安排引用了未知图层：${targetId}`);
      return;
    }
    const validated = validateProps(readProps(bag), targetId);
    changes[targetId] = { ...(changes[targetId] ?? {}), ...validated };
  };

  rawFrames.forEach((frame, index) => {
    requireThat(isPlainObject(frame), `第 ${index + 1} 帧必须是对象`);
    const changes = {};

    // 1) Recognised change containers.
    for (const key of CHANGE_KEYS) {
      if (!hasOwn(frame, key) || frame[key] == null) continue;
      const collection = frame[key];
      if (Array.isArray(collection)) {
        for (const entry of collection) {
          requireThat(isPlainObject(entry), `第 ${index + 1} 帧的图层改动必须是对象`);
          const target = TARGET_KEYS.map(k => entry[k]).find(value => value != null)
            ?? (layerIds.has(entry.id) ? entry.id : undefined);
          addChange(changes, target, entry);
        }
      } else if (isPlainObject(collection)) {
        for (const [key, bag] of Object.entries(collection)) {
          // Dotted form: { 'cut.x': 22, 'ink.opacity': 0.4 }.
          const dotted = /^(.+?)\.(x|y|opacity)$/.exec(key);
          if (dotted && layerIds.has(dotted[1])) {
            addChange(changes, dotted[1], { [dotted[2]]: bag });
          } else {
            addChange(changes, key, bag);
          }
        }
      } else {
        throw new InputError(`第 ${index + 1} 帧的 ${key} 必须是对象或数组`);
      }
    }

    // 2) Flat single-layer change: { at, layer:'id', x, y, opacity }.
    const explicitTarget = TARGET_KEYS.map(key => frame[key]).find(value => value != null);
    if (explicitTarget !== undefined) addChange(changes, explicitTarget, frame);
    if (frame.id != null && layerIds.has(frame.id) && explicitTarget === undefined) {
      addChange(changes, frame.id, frame);
    }

    // 3) Any remaining key that exactly names a layer: { at, crop:{x} }.
    for (const [key, bag] of Object.entries(frame)) {
      if (TIME_KEYS.includes(key) || HOLD_KEYS.includes(key) || END_KEYS.includes(key)) continue;
      if (CHANGE_KEYS.includes(key) || TARGET_KEYS.includes(key) || key === 'id') continue;
      if (layerIds.has(key)) addChange(changes, key, bag);
    }

    changesPerFrame.push(changes);
  });

  // Timing: explicit starts preferred; cumulative holds accepted as an alias.
  const starts = rawFrames.map((frame, index) => readInteger(frame, TIME_KEYS, `第 ${index + 1} 帧起点`));
  const holds = rawFrames.map((frame, index) => readInteger(frame, HOLD_KEYS, `第 ${index + 1} 帧保持时长`));
  const at = [];
  for (let index = 0; index < rawFrames.length; index++) {
    if (starts[index] !== undefined) {
      at[index] = starts[index];
    } else if (index === 0) {
      at[0] = holds[0] !== undefined ? 0 : 0;
    } else if (holds[index - 1] !== undefined) {
      at[index] = at[index - 1] + holds[index - 1];
    } else {
      throw new InputError(`第 ${index + 1} 帧缺少起点毫秒`);
    }
    requireThat(Number.isInteger(at[index]) && at[index] >= 0, `第 ${index + 1} 帧起点无效`);
    if (index > 0) {
      requireThat(at[index] > at[index - 1], `第 ${index + 1} 帧起点必须严格递增`);
    } else {
      requireThat(at[0] === 0, '首帧必须从 0 毫秒开始');
    }
  }

  const lastIndex = rawFrames.length - 1;
  let end = readInteger(raw, END_KEYS, '循环终点') ?? readInteger(sibling, END_KEYS, '循环终点');
  if (end === undefined) {
    if (holds[lastIndex] !== undefined) end = at[lastIndex] + holds[lastIndex];
  }
  // Alias: a bare numeric loop/cycle timestamp may denote the loop endpoint,
  // but only when it behaves like one (after the last start, within the cap).
  if (end === undefined) {
    for (const source of [raw, sibling]) {
      for (const key of ['loop', 'cycle']) {
        const value = source?.[key];
        if (Number.isInteger(value) && value > at[lastIndex] && value <= LOOP_END_MAX) { end = value; break; }
        if (isPlainObject(value)) {
          const nested = readInteger(value, END_KEYS, '循环终点');
          if (nested !== undefined) { end = nested; break; }
        }
      }
      if (end !== undefined) break;
    }
  }
  requireThat(Number.isInteger(end), '帧安排需要整数毫秒的循环终点');
  requireThat(end > at[at.length - 1], '循环终点必须晚于末帧起点');
  requireThat(end <= LOOP_END_MAX, `循环终点不能超过 ${LOOP_END_MAX} 毫秒`);

  const width = context.width ?? input?.width, height = context.height ?? input?.height;
  const samples = context.samples ?? input?.samples;
  const layerCount = context.layerCount ?? contextLayers.length;
  const costPerFrame = width * height * samples * samples * layerCount;
  const budget = costPerFrame * rawFrames.length;
  requireThat(Number.isSafeInteger(budget), '帧安排总量超出渲染预算');
  requireThat(budget <= RENDER_BUDGET, `整段循环的渲染量 ${budget} 超出一次校样预算 ${RENDER_BUDGET}`);

  let plays = 0;
  const loopSetting = isPlainObject(raw.loop) ? raw.loop : (isPlainObject(sibling.loop) ? sibling.loop : undefined);
  const rawPlays = raw.plays ?? raw.repeat ?? raw.numPlays ?? raw.loopCount
    ?? loopSetting?.plays ?? loopSetting?.count ?? sibling.plays
    ?? (typeof raw.loop === 'string' || typeof raw.loop === 'boolean' ? raw.loop : undefined);
  if (rawPlays !== undefined) {
    if (rawPlays === 'infinite' || rawPlays === 'loop' || rawPlays === true || rawPlays === 0) plays = 0;
    else if (rawPlays === false || rawPlays === 1 || rawPlays === 'once') plays = 1;
    else plays = number(rawPlays, 0, 100000, '循环次数', true);
  }

  return {
    end,
    plays,
    budget,
    costPerFrame,
    frames: at.map((time, index) => ({ at: time, changes: changesPerFrame[index] })),
  };
}

// Convenience used by direct module callers: accept a raw or normalized doc and
// return its canonical schedule (normalizing the document if necessary).
export function asSchedule(documentInput) {
  if (documentInput?.animation?.frames) return documentInput.animation;
  return normalize(documentInput).animation;
}

// Accepts either a canonical schedule or a document carrying one.
function scheduleFrom(source) {
  if (source?.frames && source?.end !== undefined) return source;
  if (source?.animation?.frames) return source.animation;
  return undefined;
}

// Builds the effective layer stack for one frame by folding every preceding
// frame's sparse changes from the pristine normalized document. Never mutates
// the normalized document, so arbitrary/out-of-order frame previews agree.
export function frameDocument(document, index = 0) {
  const animation = document.animation;
  requireThat(animation?.frames?.length, '工作稿没有帧安排');
  const frameIndex = Number(index);
  requireThat(Number.isInteger(frameIndex) && frameIndex >= 0 && frameIndex < animation.frames.length,
    `帧序号需要 0–${animation.frames.length - 1} 的整数`);

  const indexById = new Map(document.layers.map((layer, i) => [layer.id, i]));
  const state = document.layers.map(layer => ({
    x: layer.transform.x,
    y: layer.transform.y,
    opacity: layer.opacity,
  }));

  for (let f = 0; f <= frameIndex; f++) {
    for (const [layerId, props] of Object.entries(animation.frames[f].changes)) {
      const i = indexById.get(layerId);
      if (i === undefined) throw new InputError(`帧安排引用了未知图层：${layerId}`);
      Object.assign(state[i], props);
    }
  }

  const layers = document.layers.map((layer, i) => ({
    ...layer,
    opacity: state[i].opacity,
    transform: { ...layer.transform, x: state[i].x, y: state[i].y },
  }));
  return { ...document, layers };
}

export function frameHolds(source) {
  const schedule = scheduleFrom(source) ?? source;
  requireThat(schedule?.frames?.length, '工作稿没有帧安排');
  return schedule.frames.map((frame, i) =>
    i + 1 < schedule.frames.length ? schedule.frames[i + 1].at - frame.at : schedule.end - frame.at);
}

// Accepts either a raw working document or an already-normalized one.
// normalize() is total and idempotent, so direct module callers may pass either.
function ensureDocument(documentInput) {
  if (documentInput?.animation && typeof documentInput.animation.budget === 'number'
    && Array.isArray(documentInput.animation.frames)
    && documentInput.animation.frames.every(frame => isPlainObject(frame.changes))) {
    return documentInput;
  }
  return normalize(documentInput);
}

export function renderFrame(documentInput, index = 0) {
  const document = ensureDocument(documentInput);
  requireThat(document.animation?.frames?.length, '工作稿没有帧安排');
  const frameIndex = Number(index);
  const framed = frameDocument(document, frameIndex);
  const { pixels, painted, partial, layers } = raster(framed);
  const bytes = png(framed.width, framed.height, pixels);
  const holds = frameHolds(document.animation);
  return {
    bytes,
    pixels,
    summary: {
      id: document.id, width: document.width, height: document.height, samples: document.samples,
      painted, partial, layers, frame: frameIndex, at: document.animation.frames[frameIndex].at,
      hold: holds[frameIndex], frames: document.animation.frames.length, end: document.animation.end,
    },
  };
}

// Rasterizes every effective frame and encodes the looping transparent APNG.
// The complete buffer is returned before the network layer replies, so a
// validation/budget failure can never publish half an animation.
export function renderAnimation(documentInput) {
  const document = ensureDocument(documentInput);
  const animation = document.animation;
  requireThat(animation?.frames?.length, '工作稿没有帧安排');
  const holds = frameHolds(animation);
  const rawFrames = [];
  const frameRecords = [];
  let paintedTotal = 0, partialTotal = 0;
  for (let i = 0; i < animation.frames.length; i++) {
    const framed = frameDocument(document, i);
    const result = raster(framed);
    rawFrames.push(result.pixels);
    paintedTotal += result.painted;
    partialTotal += result.partial;
    frameRecords.push({
      index: i,
      at: animation.frames[i].at,
      delay: holds[i],
      hold: holds[i],
      base64: png(framed.width, framed.height, result.pixels).toString('base64'),
      stats: { painted: result.painted, partial: result.partial, layers: result.layers },
    });
  }
  const bytes = encodeAPNG(document.width, document.height, rawFrames, holds, { plays: animation.plays ?? 0 });
  const summary = {
    id: document.id, width: document.width, height: document.height, samples: document.samples,
    frames: animation.frames.length, delays: holds, holds, end: animation.end,
    budget: animation.budget, loop: animation.plays ?? 0,
    painted: paintedTotal, partial: partialTotal,
  };
  return { bytes, holds, delays: holds, frames: frameRecords, summary };
}

// High-level document -> APNG Buffer with a rich result attached. Several
// entry-point conventions are served from this one implementation.
export function buildAPNG(documentInput) {
  const result = renderAnimation(documentInput);
  const buffer = result.bytes;
  const base64 = buffer.toString('base64');
  buffer.base64 = base64;
  buffer.bytes = buffer;
  buffer.apng = buffer;
  buffer.apngBase64 = base64;
  buffer.holds = result.delays;
  buffer.delays = result.delays;
  buffer.frames = result.frames;
  buffer.summary = result.summary;
  buffer.toJSON = () => ({ type: 'image/apng', base64: buffer.base64, delays: buffer.delays, summary: buffer.summary });
  return buffer;
}

// Document-first aliases. Every one resolves to the same rich Buffer: it is
// itself a Uint8Array/Buffer and also carries .base64, .bytes and .summary.
export const renderAPNG = buildAPNG;
export const renderApng = buildAPNG;
export const exportAPNG = buildAPNG;
export const buildApng = buildAPNG;
export const produceAPNG = buildAPNG;
export const composeAPNG = buildAPNG;
export const createLoop = buildAPNG;

// Rich object result for callers that expect { bytes, base64, ... }.
export function exportAnimation(documentInput) {
  const document = documentInput?.animation?.frames ? documentInput : normalize(documentInput);
  const result = renderAnimation(document);
  const base64 = result.bytes.toString('base64');
  return {
    ...result,
    buffer: result.bytes,
    apng: result.bytes,
    base64,
    apngBase64: base64,
    type: 'image/apng',
    contentType: 'image/apng',
  };
}
