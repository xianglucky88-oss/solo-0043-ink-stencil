import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { InputError } from './input.mjs';
import { send } from './responses.mjs';

const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript' };
const csp = "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const offlineCsp = "default-src 'self' blob: data:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export async function servePage(path, res) {
  let file = path === '/' ? 'index.html' : path.slice(1);
  if (file.startsWith('web/')) file = file.slice(4);
  const tileAliases = new Set([
    '/tile', '/tile.html', '/tile-proof', '/tile-proof.html', '/tile-lab', '/tile-lab.html',
    '/pattern', '/pattern.html', '/pattern-proof', '/pattern-proof.html',
    '/offline', '/offline.html', '/wallpaper', '/wallpaper.html',
  ]);
  if (tileAliases.has(path)) file = 'tile-proof.html';
  const mime = types[extname(file)];
  if (!mime || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*\.(html|css|mjs)$/.test(file)) throw new InputError('页面不存在', 404);
  try {
    const contents = await readFile(new URL(`../web/${file}`, import.meta.url));
    send(res, 200, contents, `${mime}; charset=utf-8`, {
      'Content-Security-Policy': file === 'tile-proof.html' ? offlineCsp : csp,
    });
  } catch (error) {
    if (error.code === 'ENOENT') throw new InputError('页面不存在', 404);
    throw error;
  }
}
