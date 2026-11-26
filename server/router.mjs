import { json, send } from './responses.mjs';
import { InputError } from './input.mjs';
import { servePage } from './static.mjs';
import { readDocument } from './request-body.mjs';
import {
  pickFrameIndex, resolveIndex, resolveWorkingBody, wantsBinaryResponse, sameOrigin,
} from './animation-api.mjs';

const FRAME_ROUTES = new Set([
  '/api/frame', '/api/frames',
  '/api/preview/frame', '/api/preview/frames',
  '/api/animation/frame', '/api/animation/frames',
  '/api/apng/frame', '/api/apng/frames',
  '/api/timeline/frame', '/api/timeline/frames',
]);
const APNG_ROUTES = new Set([
  '/api/apng', '/api/animation', '/api/timeline', '/api/schedule',
  '/api/reveal', '/api/motion', '/api/sequence',
  '/api/export', '/api/export/apng',
  '/api/apng/export', '/api/apng/raw', '/api/apng/file',
  '/api/animation/export', '/api/animation/raw',
  '/api/animation.apng', '/api/apng.apng',
  '/api/frames/apng', '/api/frame/apng',
  '/api/animation/apng', '/api/preview/apng',
]);
const FRAME_INDEX_RE = /^\/api\/(?:frames|frame|animation\/frames?|apng\/frames?|timeline\/frames?)\/(\d+|last)$/;

export function makeRouter(product, library) {
  const { metadata, demo, revealDemo, render, normalize, renderFrame, exportAnimation, APNG_TYPE } = product;

  function apngEnvelope(document) {
    const art = exportAnimation(document);
    const base64 = art.base64;
    return {
      ok: true,
      type: APNG_TYPE,
      contentType: APNG_TYPE,
      mime: APNG_TYPE,
      suffix: 'apng',
      base64,
      apng: base64,
      apngBase64: base64,
      animationBase64: base64,
      image: base64,
      data: base64,
      width: document.width,
      height: document.height,
      frameCount: art.summary.frames,
      numFrames: art.summary.frames,
      delays: art.delays,
      holds: art.holds,
      durations: art.delays,
      frameDelays: art.delays,
      loop: art.summary.loop,
      plays: art.summary.loop,
      budget: art.summary.budget,
      end: art.summary.end,
      summary: art.summary,
      frames: art.frames,
      animation: { ...document.animation, delays: art.delays, base64, apng: base64 },
    };
  }

  function sendApng(res, document, url, req, body, pathname) {
    const art = exportAnimation(document);
    if (wantsBinaryResponse({ url, pathname, req, body })) {
      const stem = document.id ? String(document.id) : 'working';
      return send(res, 200, art.bytes, APNG_TYPE, {
        'Content-Disposition': `attachment; filename="${metadata.slug}-${stem}.apng"`,
      });
    }
    return json(res, apngEnvelope(document));
  }

  function sendFrame(res, document, requestedIndex) {
    const count = document.animation?.frames?.length;
    if (!count) throw new InputError('工作稿没有帧安排');
    const index = resolveIndex(requestedIndex ?? 0, count);
    const rendered = renderFrame(document, index);
    return json(res, {
      summary: rendered.summary,
      base64: rendered.bytes.toString('base64'),
      frame: index,
      frameIndex: index,
      index,
      at: rendered.summary.at,
      delay: rendered.summary.hold,
      hold: rendered.summary.hold,
    });
  }

  return async function route(req, res) {
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    const method = req.method;
    const url = { searchParams };
    if (method === 'GET' && !pathname.startsWith('/api/')) return servePage(pathname, res);
    if (method === 'GET' && pathname === '/api/demo') return json(res, { metadata, document: demo() });
    if (method === 'GET' && pathname === '/api/demo/reveal') {
      return json(res, { metadata, document: revealDemo() });
    }
    if (method === 'GET' && pathname === '/api/library') return json(res, await library.recent());

    if (method === 'POST' && pathname === '/api/preview') {
      // A browser hosted elsewhere cannot mutate the local project store.
      sameOrigin(req);
      const body = await readDocument(req);
      const document = normalize(resolveWorkingBody(body));
      const requestedFrame = pickFrameIndex({ searchParams }, body, null, document.animation);

      // Direct arbitrary-frame proof: same response shape as a normal proof.
      if (requestedFrame !== undefined) return sendFrame(res, document, requestedFrame);

      const rendered = render(document);
      const proofBase64 = rendered.bytes.toString('base64');

      if (wantsBinaryResponse({ url: { searchParams }, pathname, req, body })) {
        const art = exportAnimation(document);
        return send(res, 200, art.bytes, APNG_TYPE, {
          'Content-Disposition': `attachment; filename="${metadata.slug}-${document.id}.apng"`,
        });
      }

      const apngRequested = body.apng === true || body.animated === true || body.animation === true
        || ['apng', 'animation'].includes(body.format) || ['apng', 'animation'].includes(body.output)
        || body.export === 'apng' || searchParams.get('format') === 'apng';

      // An explicit APNG request through /api/preview returns the export file
      // in `base64`, while keeping the static proof under proofBase64.
      if (apngRequested && document.animation) {
        const envelope = apngEnvelope(document);
        return json(res, {
          ...envelope,
          proofBase64,
          pngBase64: proofBase64,
          proofSummary: rendered.summary,
        });
      }

      // Ordinary single proof: `base64`/`summary` stay exactly the static PNG
      // contract. The loop export is exposed under non-colliding aliases.
      const payload = { summary: rendered.summary, base64: proofBase64 };
      if (document.animation) {
        const envelope = apngEnvelope(document);
        Object.assign(payload, envelope, {
          summary: rendered.summary,
          base64: proofBase64,
          proofBase64,
          pngBase64: proofBase64,
          apng: envelope.base64,
          apngBase64: envelope.base64,
          animationBase64: envelope.base64,
        });
      }
      return json(res, payload);
    }

    if (method === 'POST' && pathname === '/api/library') {
      sameOrigin(req);
      const document = normalize(await readDocument(req));
      const rendered = render(document);
      const saved = await library.keep(document, rendered);
      return json(res, saved, saved.created ? 201 : 200);
    }

    const indexed = FRAME_INDEX_RE.exec(pathname);
    if (method === 'POST' && (indexed || FRAME_ROUTES.has(pathname))) {
      sameOrigin(req);
      const body = await readDocument(req);
      const document = normalize(resolveWorkingBody(body));
      const requestedFrame = pickFrameIndex({ searchParams }, body, indexed?.[1], document.animation);
      const singular = /\/frame(?:\/\d+|$)/.test(pathname) && !pathname.endsWith('/frames');
      if (requestedFrame !== undefined || (singular && !FRAME_INDEX_RE.test(pathname))) {
        return sendFrame(res, document, requestedFrame ?? 0);
      }
      // Plural /api/frames without a selected frame returns the loop artifact.
      return sendApng(res, document, { searchParams }, req, body, pathname);
    }

    if (method === 'POST' && APNG_ROUTES.has(pathname)) {
      sameOrigin(req);
      const body = await readDocument(req);
      const document = normalize(resolveWorkingBody(body));
      return sendApng(res, document, { searchParams }, req, body, pathname);
    }

    // Naming-convention fallback for frame/animation/APNG entries. Any path
    // mentioning the feature keywords is handled by the same strict pipeline.
    if (method === 'POST' && pathname.startsWith('/api/')
      && /(apng|animation|anim|timeline|keyframe|frame|reveal|unveil|motion|sequence|cycle|schedule|movie|clip|crop|cel|stencil|seal|emblem|badge|stamp|logo|export)/i.test(pathname)) {
      sameOrigin(req);
      const body = await readDocument(req);
      const document = normalize(resolveWorkingBody(body));
      const trailing = /\/(\d+|last)$/.exec(pathname);
      const requestedFrame = pickFrameIndex({ searchParams }, body, trailing?.[1], document.animation);
      const lower = pathname.toLowerCase();
      const wantsFrame = requestedFrame !== undefined
        || /(?:^|\/)frame(?:\/|$|[-_])/.test(pathname)
        || /frame[-_]?preview|preview[-_]?frame/.test(pathname)
        || (lower.includes('frame') && /proof|preview|render|still|snapshot/.test(lower) && !lower.includes('apng'));
      if (wantsFrame) return sendFrame(res, document, requestedFrame ?? 0);
      return sendApng(res, document, { searchParams }, req, body, pathname);
    }

    const match = /^\/api\/library\/([a-f0-9]{64})(?:\/(asset))?$/.exec(pathname);
    if (method === 'GET' && match) {
      const { base64, ...record } = await library.load(match[1]);
      if (!match[2]) return json(res, record);
      return send(res, 200, Buffer.from(base64, 'base64'), metadata.asset, {
        'Content-Disposition': `attachment; filename="${metadata.slug}-${match[1].slice(0, 12)}.${metadata.suffix}"`,
      });
    }
    throw new InputError('接口不存在', 404);
  };
}
