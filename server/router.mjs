import { readDocument } from './request-body.mjs';
import { json, send } from './responses.mjs';
import { servePage } from './static.mjs';
import { InputError } from './input.mjs';

export function makeRouter(product, library) {
  const { metadata, demo, render, normalize } = product;
  return async function route(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    const method = req.method;
    if (method === 'GET' && !pathname.startsWith('/api/')) return servePage(pathname, res);
    if (method === 'GET' && pathname === '/api/demo') return json(res, { metadata, document: demo() });
    if (method === 'GET' && pathname === '/api/library') return json(res, await library.recent());
    if (method === 'POST' && ['/api/preview', '/api/library'].includes(pathname)) {
      // A browser hosted elsewhere cannot mutate the local project store.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new InputError('请求不是来自当前工作台', 403);
      const document = normalize(await readDocument(req));
      const rendered = render(document);
      if (pathname === '/api/preview') return json(res, { summary: rendered.summary, base64: rendered.bytes.toString('base64') });
      const saved = await library.keep(document, rendered);
      return json(res, saved, saved.created ? 201 : 200);
    }
    const match = /^\/api\/library\/([a-f0-9]{64})(?:\/(asset))?$/.exec(pathname);
    if (method === 'GET' && match) {
      const { base64, ...record } = await library.load(match[1]);
      if (!match[2]) return json(res, record);
      return send(res, 200, Buffer.from(base64, 'base64'), metadata.asset, {
        'Content-Disposition': `attachment; filename="${metadata.slug}-${match[1].slice(0,12)}.${metadata.suffix}"`,
      });
    }
    throw new InputError('接口不存在', 404);
  };
}
