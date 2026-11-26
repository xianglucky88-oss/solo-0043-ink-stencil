import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { InputError } from './input.mjs';
import { send } from './responses.mjs';

const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript' };
const csp = "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

// The browser composites marks locally and only needs the dependency-free
// plate math module; no document, shape or transform code is exposed.
const browserModules = new Set(['mark.mjs']);

export async function servePage(path, res) {
  const file = path === '/' ? 'index.html' : path.slice(1);
  const mime = types[extname(file)];
  const webAsset = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*\.(html|css|mjs)$/.test(file);
  const productAsset = /^product\/([a-z0-9-]+\.mjs)$/.test(file) && browserModules.has(file.slice(8));
  if (!mime || !(webAsset || productAsset)) throw new InputError('页面不存在', 404);
  try {
    const root = productAsset ? '../' : '../web/';
    const contents = await readFile(new URL(`${root}${file}`, import.meta.url));
    send(res, 200, contents, `${mime}; charset=utf-8`, { 'Content-Security-Policy': csp });
  } catch (error) {
    if (error.code === 'ENOENT') throw new InputError('页面不存在', 404);
    throw error;
  }
}
