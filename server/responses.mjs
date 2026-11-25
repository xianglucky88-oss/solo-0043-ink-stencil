import { InputError } from './input.mjs';

export function send(res, status, bytes, type, headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(bytes),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(bytes);
}

export function json(res, value, status = 200) {
  send(res, status, JSON.stringify(value), 'application/json; charset=utf-8');
}

export function respondError(res, error) {
  if (res.headersSent || res.destroyed) return res.destroy();
  if (error instanceof InputError) return json(res, { error: error.message }, error.status);
  console.error(error);
  json(res, { error: '服务未能完成该操作' }, 500);
}
