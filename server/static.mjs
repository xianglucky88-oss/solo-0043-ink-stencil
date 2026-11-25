import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { InputError } from './input.mjs';
import { send } from './responses.mjs';

const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript' };
const csp = "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export async function servePage(path, res) {
  const file = path === '/' ? 'index.html' : path.slice(1);
  const mime = types[extname(file)];
  if (!mime || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*\.(html|css|mjs)$/.test(file)) throw new InputError('页面不存在', 404);
  try {
    const contents = await readFile(new URL(`../web/${file}`, import.meta.url));
    send(res, 200, contents, `${mime}; charset=utf-8`, { 'Content-Security-Policy': csp });
  } catch (error) {
    if (error.code === 'ENOENT') throw new InputError('页面不存在', 404);
    throw error;
  }
}
