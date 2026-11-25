import { createServer } from 'node:http';
import { environment } from './server/environment.mjs';
import { makeRouter } from './server/router.mjs';
import { respondError } from './server/responses.mjs';
import { openLibrary } from './server/library.mjs';
import * as product from './product/index.mjs';

export async function start(options = environment()) {
  const library = await openLibrary(options.storage, product.metadata);
  const route = makeRouter(product, library);
  const server = createServer((req, res) => route(req, res).catch(error => respondError(res, error)));
  server.requestTimeout = 45_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', resolve);
  });
  return server;
}
