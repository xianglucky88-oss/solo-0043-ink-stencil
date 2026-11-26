import { InputError } from './input.mjs';

// Minimal multipart/form-data reader for the plate proof workbench. Two PNG
// files plus a few text fields; no nested bodies. Returns `{ fields, files }`
// where files are Buffers. JSON requests go through request-body.readDocument.
export async function readMultipart(req, limit = 12 * 1024 * 1024) {
  const contentType = req.headers['content-type'] ?? '';
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw new InputError('multipart 缺少 boundary', 400);
  const boundary = Buffer.from(`--${(match[1] ?? match[2]).trim()}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw new InputError('校样文件超过上传上限', 413);
  const body = Buffer.concat(chunks);
  const fields = {};
  const files = {};
  let start = body.indexOf(boundary);
  if (start === -1) throw new InputError('multipart 正文无法识别', 400);
  start += boundary.length;
  while (true) {
    if (body[start] === 45 && body[start + 1] === 45) break; // closing --
    if (body[start] === 13 && body[start + 1] === 10) start += 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), start);
    if (headerEnd === -1) break;
    const headerText = body.subarray(start, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(boundary, dataStart);
    if (nextBoundary === -1) break;
    let data = body.subarray(dataStart, nextBoundary - 2); // strip trailing CRLF
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    const name = nameMatch?.[1];
    if (name) {
      if (fileMatch) files[name] = data;
      else fields[name] = data.toString('utf8');
    }
    start = nextBoundary + boundary.length;
  }
  return { fields, files };
}

// Fold multipart text fields (dx/dy/colors as strings) into the flexible body
// shape understood by product.proofFromBody.
export function multipartToBody({ fields, files }) {
  const body = { ...fields };
  // Object-valued fields may arrive as JSON text.
  for (const key of ['shift', 'offset', 'shiftA', 'shiftB', 'offsetA', 'offsetB', 'inks', 'inkColors', 'colors']) {
    if (typeof body[key] === 'string' && body[key].trim().startsWith('{')) {
      try { body[key] = JSON.parse(body[key]); } catch { /* leave as string */ }
    }
  }
  for (const key of ['dx', 'dy', 'x', 'y']) {
    if (body[key] !== undefined) body[key] = Number(body[key]);
  }
  for (const prefix of ['shiftA', 'shiftB', 'offsetA', 'offsetB']) {
    if (fields[`${prefix}.dx`] !== undefined || fields[`${prefix}.dy`] !== undefined) {
      body[prefix] = { dx: Number(fields[`${prefix}.dx`] ?? 0), dy: Number(fields[`${prefix}.dy`] ?? 0) };
    }
  }
  // Map common single-file field names onto a/b.
  const aliases = { a: ['a', 'plateA', 'fileA', 'first', 'inkA'], b: ['b', 'plateB', 'fileB', 'second', 'inkB'] };
  const normalizedFiles = {};
  for (const [target, names] of Object.entries(aliases)) {
    for (const name of names) {
      if (files[name] && files[name].length) { normalizedFiles[target] = files[name]; break; }
    }
  }
  return { body, files: normalizedFiles };
}
