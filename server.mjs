import { createServer } from 'node:http';
import { join } from 'node:path';
import { environment } from './server/environment.mjs';
import { makeRouter } from './server/router.mjs';
import { respondError } from './server/responses.mjs';
import { openLibrary } from './server/library.mjs';
import { openKits } from './server/kits.mjs';
import { buildTileKit } from './product/kits.mjs';
import * as product from './product/index.mjs';

export async function start(options = environment()) {
  const library = await openLibrary(options.storage, product.metadata);
  const kits = await openKits(join(options.storage, 'kits'), {
    loadSource: id => library.load(id),
    build: buildTileKit,
  });
  const route = makeRouter(product, library, kits);
  const server = createServer((req, res) => route(req, res).catch(error => respondError(res, error)));
  server.requestTimeout = 45_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', resolve);
  });
  return server;
}
