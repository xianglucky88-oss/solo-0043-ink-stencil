import { readDocument } from './request-body.mjs';
import { json, send } from './responses.mjs';
import { servePage } from './static.mjs';
import { InputError } from './input.mjs';
import { renderIncremental } from '../product/incremental.mjs';
import { openPreviewCache } from './preview-cache.mjs';
import { png } from '../product/png.mjs';

function isEnvelope(value) {
  return value && typeof value==='object' && !Array.isArray(value)
    && Object.hasOwn(value,'document') && (value.base==null || typeof value.base==='object');
}

export function makeRouter(product, library, previewCache=openPreviewCache()) {
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
      const body=await readDocument(req);
      const envelope=isEnvelope(body);
      const document=normalize(envelope ? body.document : body);
      if (pathname === '/api/library') {
        const saved = await library.keep(document, render(document));
        return json(res, saved, saved.created ? 201 : 200);
      }
      // Resolve the cached base before rendering this submission, so a single
      // request cannot evict the very entry it needs for local recompute.
      let baseEntry=null;
      if (envelope && body.base) {
        let baseDocument;
        try { baseDocument=normalize(body.base); }
        catch { baseDocument=null; }
        if (baseDocument) {
          baseEntry=previewCache.get(baseDocument);
          if (!baseEntry) {
            // A base not yet cached (e.g. an earlier response still in flight)
            // is rendered once and retained, so local recompute does not depend
            // on response ordering.
            const baseRendered=render(baseDocument);
            baseEntry={ key:previewCache.key(baseDocument), document:baseDocument,
              pixels:Buffer.from(baseRendered.pixels), summary:baseRendered.summary };
            previewCache.put(baseEntry);
          }
        }
      }
      // Local path repaints only the affected rectangle; anything else skips
      // coverage/blend work entirely and falls back to a full render.
      if (baseEntry) {
        const local=renderIncremental(baseEntry,document);
        if (local) {
          previewCache.put({ key:previewCache.key(document), document,
            pixels:Buffer.from(local.pixels), summary:local.summary });
          // Encode the spliced buffer as PNG like a full render; only the
          // rectangle above went through coverage/blend recomputation.
          return json(res, {
            mode:'incremental', summary:local.summary,
            base64:png(document.width,document.height,local.pixels).toString('base64'),
            recomputed:local.recomputed, region:local.region, patch:local.patch.toString('base64'),
          });
        }
      }
      const rendered=render(document);
      previewCache.put({ key:previewCache.key(document), document,
        pixels:Buffer.from(rendered.pixels), summary:rendered.summary });
      return json(res, { mode:'full', summary:rendered.summary, base64:rendered.bytes.toString('base64') });
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
