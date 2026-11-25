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
