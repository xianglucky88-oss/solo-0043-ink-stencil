import { InputError, object } from './input.mjs';

export async function readDocument(req, limit = 6 * 1024 * 1024) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    req.resume();
    throw new InputError('请发送 application/json', 415);
  }
  const chunks = [];
  let size = 0;
  // Drain oversized bodies without retaining more than the request budget.
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw new InputError('文档超过上传上限', 413);
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new InputError('正文不是有效的 UTF-8 JSON', 400);
  }
  return object(value, '工作文档');
}

export async function readBinary(req, limit = 6 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw new InputError('PNG 超过上传上限', 413);
  return Buffer.concat(chunks);
}

// Extract the file part from multipart/form-data. Small, dependency free; the
// workbench only ever uploads one PNG at a time but callers may add fields.
function extractMultipartFile(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw new InputError('multipart 缺少 boundary', 400);
  const boundary = Buffer.from(`--${(match[1] ?? match[2]).trim()}`);
  const candidates = [];
  let cursor = body.indexOf(boundary);
  while (cursor !== -1) {
    const partStart = cursor + boundary.length;
    if (body[partStart] === 45 && body[partStart + 1] === 45) break; // closing --
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), partStart);
    if (headerEnd === -1) break;
    const nextBoundary = body.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), headerEnd + 4);
    if (nextBoundary === -1) break;
    const headers = body.subarray(partStart, headerEnd).toString('latin1');
    const data = body.subarray(headerEnd + 4, nextBoundary);
    candidates.push({ headers, data });
    cursor = body.indexOf(boundary, nextBoundary + 2);
  }
  if (!candidates.length) throw new InputError('multipart 文件段未找到', 400);
  const namedFile = candidates.find(p => /filename=/i.test(p.headers) || /content-type:\s*image\/png/i.test(p.headers));
  return (namedFile ?? candidates[0]).data;
}

// Resolve a recovery request to either raw PNG bytes or a JSON envelope.
export async function readPngSource(req) {
  const contentType = req.headers['content-type'] ?? '';
  const media = contentType.split(';')[0].trim().toLowerCase();
  if (media === 'application/json') return readDocument(req);
  const body = await readBinary(req);
  if (media === 'multipart/form-data') return extractMultipartFile(body, contentType);
  if (media === 'application/x-www-form-urlencoded') {
    const params = new URLSearchParams(body.toString('utf8'));
    for (const key of ['png', 'image', 'data', 'base64', 'file']) {
      if (params.get(key)) return { [key]: params.get(key) };
    }
  }
  return body; // image/png, application/octet-stream, ...
}

export function looksLikePngEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  // A body that already carries document layers is a JSON document, even if a
  // caller threads a preview base64 field along with it.
  if (Array.isArray(value.layers)) return false;
  return ['png', 'pngBase64', 'png_base64', 'image', 'imageBase64', 'base64', 'data'].some(key => {
    const v = value[key];
    if (v instanceof Uint8Array || Array.isArray(v)) return true;
    return typeof v === 'string' && (v.startsWith('data:image/png') || /^[a-z0-9+/=\s]{64,}$/i.test(v));
  });
}

