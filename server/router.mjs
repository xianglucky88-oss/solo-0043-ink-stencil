import { readDocument, readPngSource, looksLikePngEnvelope } from './request-body.mjs';
import { json, send } from './responses.mjs';
import { servePage } from './static.mjs';
import { InputError } from './input.mjs';

const RECOVER_ROUTES = new Set([
  '/api/recover', '/api/recovery', '/api/recover-png', '/api/trace', '/api/vectorize',
  '/api/vectorize-png', '/api/import-png', '/api/png/import', '/api/png/recover', '/api/png',
  '/api/import/png', '/api/import/image', '/api/image/import', '/api/image/recover',
  '/api/import', '/api/upload', '/api/logo', '/api/logo/import', '/api/import-logo', '/api/mark/recover',
  '/api/restore', '/api/from-png',
]);

function sameOrigin(req) {
  // A browser hosted elsewhere cannot mutate the local project store.
  return !req.headers.origin || req.headers.origin === `http://${req.headers.host}`;
}

export function makeRouter(product, library) {
  const { metadata, demo, render, normalize, recoverFromPng } = product;

  function recoveredResponse(source, url) {
    const result = recoverFromPng(source);
    if (url.searchParams.has('samples')) {
      result.document = normalize({ ...result.document, samples: Number(url.searchParams.get('samples')) });
    }
    const rendered = render(result.document);
    return {
      status: 200,
      body: {
        ...result.document,
        document: result.document,
        doc: result.document,
        recovery: result.info,
        summary: rendered.summary,
        base64: rendered.bytes.toString('base64'),
      },
    };
  }

  return async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    const method = req.method;
    if (method === 'GET' && !pathname.startsWith('/api/')) return servePage(pathname, res);
    if (method === 'GET' && pathname === '/api/demo') return json(res, { metadata, document: demo() });
    if (method === 'GET' && pathname === '/api/library') return json(res, await library.recent());

    if (method === 'POST' && RECOVER_ROUTES.has(pathname)) {
      if (!sameOrigin(req)) throw new InputError('请求不是来自当前工作台', 403);
      const source = await readPngSource(req);
      const response = recoveredResponse(source, url);
      return json(res, response.body, response.status);
    }

    if (method === 'POST' && ['/api/preview', '/api/library'].includes(pathname)) {
      if (!sameOrigin(req)) throw new InputError('请求不是来自当前工作台', 403);

      let document;
      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (contentType === 'image/png' || contentType === 'application/octet-stream') {
        const result = recoverFromPng(await readPngSource(req));
        document = url.searchParams.has('samples')
          ? normalize({ ...result.document, samples: Number(url.searchParams.get('samples')) })
          : result.document;
      } else {
        const input = await readDocument(req);
        if (looksLikePngEnvelope(input)) {
          const result = recoverFromPng(input);
          document = normalize({
            ...result.document,
            ...(input.samples === 1 || input.samples === 2 ? { samples: input.samples } : {}),
            ...(input.width != null ? { width: input.width } : {}),
            ...(input.height != null ? { height: input.height } : {}),
          });
        } else {
          document = normalize(input);
        }
      }

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
