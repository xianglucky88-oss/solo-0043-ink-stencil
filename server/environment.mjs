import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { metadata } from '../product/config.mjs';

export function environment() {
  const port = Number(process.env.PORT ?? metadata.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 超出范围');
  return {
    port,
    storage: process.env.MEDIA_HOME ? resolve(process.env.MEDIA_HOME) : fileURLToPath(new URL('../.local', import.meta.url)),
  };
}
