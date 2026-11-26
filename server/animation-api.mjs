import { InputError, requireThat } from './input.mjs';

const WRAPPER_KEYS = ['document', 'doc', 'draft', 'proof', 'working', 'data', 'payload'];
const SCHEDULE_KEYS = [
  'animation', 'anim', 'apng', 'timeline', 'schedule', 'motion', 'reveal',
  'sequence', 'frames', 'keyframes', 'cells', 'cels',
];
const END_KEYS = ['end', 'endAt', 'endTime', 'duration', 'loopEnd', 'cycleEnd'];

// Accepts either a raw working document or an envelope such as
// { document:{...}, frames:[...], end:500 }.
export function resolveWorkingBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  if (Array.isArray(body.layers)) return body;
  for (const key of WRAPPER_KEYS) {
    const inner = body[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner) && Array.isArray(inner.layers)) {
      const doc = { ...inner };
      for (const scheduleKey of SCHEDULE_KEYS) {
        if (body[scheduleKey] !== undefined && doc[scheduleKey] === undefined) {
          doc[scheduleKey] = body[scheduleKey];
        }
      }
      for (const endKey of END_KEYS) {
        if (body[endKey] !== undefined && doc[endKey] === undefined) doc[endKey] = body[endKey];
      }
      return doc;
    }
  }
  return body;
}

function parseIndex(value) {
  if (value === 'last') return -1;
  const number_ = Number(value);
  requireThat(Number.isInteger(number_), '帧序号必须是整数');
  return number_;
}

const INDEX_KEYS = ['frame', 'f', 'frameIndex', 'atFrame', 'frameAt', 'selectedFrame', 'currentFrame', 'index'];
const TIME_KEYS = ['time', 'at', 'ms', 'start', 'timeMs', 'atTime'];

// Millisecond timestamp -> the frame on stage at that instant.
export function frameAtTime(animation, ms) {
  requireThat(Number.isFinite(ms) && ms >= 0, '帧时间必须是不小于 0 的毫秒数');
  const frames = animation.frames;
  let index = 0;
  for (let i = 0; i < frames.length; i++) if (ms >= frames[i].at) index = i;
  if (ms >= animation.end) index = frames.length - 1;
  return index;
}

// Finds an optional selected frame across path/query/body conventions. Values
// may be a zero-based index or a millisecond timestamp (at/time/start).
export function pickFrameIndex(url, body, pathIndex, animation) {
  if (pathIndex !== undefined && pathIndex !== null) return { index: parseIndex(pathIndex) };
  for (const key of INDEX_KEYS) {
    const value = url.searchParams.get(key);
    if (value !== null) return { index: parseIndex(value) };
  }
  for (const key of TIME_KEYS) {
    const value = url.searchParams.get(key);
    if (value !== null && animation) return { index: frameAtTime(animation, Number(value)) };
  }
  const sources = [body, body?.document, body?.doc];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of INDEX_KEYS) {
      const value = source[key];
      if (value !== undefined && value !== null && value !== '') return { index: parseIndex(value) };
    }
  }
  for (const source of sources) {
    if (!source || typeof source !== 'object' || !animation) continue;
    for (const key of TIME_KEYS) {
      const value = source[key];
      if (value !== undefined && value !== null && value !== '') return { index: frameAtTime(animation, Number(value)) };
    }
  }
  return undefined;
}

export function resolveIndex(selection, count) {
  if (selection === undefined || selection === null) return undefined;
  const raw = typeof selection === 'number' ? selection : selection.index;
  if (raw === undefined) return undefined;
  const resolved = raw < 0 ? count + raw : raw;
  requireThat(Number.isInteger(resolved) && resolved >= 0 && resolved < count, `帧序号需要 0–${count - 1} 的整数`);
  return resolved;
}

const BINARY_FORMATS = new Set(['binary', 'raw', 'file', 'blob', 'bytes', 'apng-file', 'download']);
const JSON_FORMATS = new Set(['json', 'base64']);

// Decides whether the caller wants raw APNG bytes or the JSON/base64 envelope.
export function wantsBinaryResponse({ url, pathname, req, body }) {
  const queryFormat = url.searchParams.get('format') ?? url.searchParams.get('output') ?? url.searchParams.get('as');
  if (queryFormat && BINARY_FORMATS.has(queryFormat)) return true;
  if (queryFormat && JSON_FORMATS.has(queryFormat)) return false;
  if (url.searchParams.has('binary') || url.searchParams.has('raw') || url.searchParams.has('download')) return true;
  if (url.searchParams.has('json')) return false;
  if (body && (body.binary === true || body.raw === true || body.download === true)) return true;
  if (body && (body.json === true || body.base64 === true)) return false;
  if (body?.format && BINARY_FORMATS.has(body.format)) return true;
  if (body?.format && JSON_FORMATS.has(body.format)) return false;
  if (pathname.endsWith('.apng')) return true;
  if (/(?:^|\/)(raw|binary|download|file)(?:\/|$)/.test(pathname)) return true;
  if (/\/export(?:\/|$)/.test(pathname)) return true;
  const accept = req.headers.accept ?? '';
  if (accept.includes('image/apng')) return true;
  if (accept.includes('image/') && !accept.includes('application/json')) return true;
  return false;
}

export function sameOrigin(req) {
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
    throw new InputError('请求不是来自当前工作台', 403);
  }
}
