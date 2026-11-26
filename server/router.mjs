import { readDocument } from './request-body.mjs';
import { json, send } from './responses.mjs';
import { servePage } from './static.mjs';
import { InputError } from './input.mjs';
import { readMultipart, multipartToBody } from './multipart.mjs';
import { png } from '../product/png.mjs';

// Rich plate DTO. Bare base64 strings, object files and named aliases are all
// provided so workflow scripts can reach the two delivered PNGs either way.
function platePayload(plates) {
  const [a, b] = plates.files;
  const dto = (file) => ({
    id: file.id, plate: file.id, ink: file.index, index: file.index,
    width: file.width, height: file.height,
    mediaType: file.mediaType, type: file.type, suffix: file.suffix, filename: file.filename,
    base64: file.base64,
  });
  const fileA = dto(a), fileB = dto(b);
  return {
    width: plates.width,
    height: plates.height,
    samples: plates.samples,
    // Codebase convention: PNG payloads are bare base64 strings.
    plates: [fileA, fileB],
    plateBase64: [a.base64, b.base64],
    plateStrings: [a.base64, b.base64],
    plateFiles: [fileA, fileB],
    inkFiles: [fileA, fileB],
    separations: [fileA, fileB],
    separationFiles: [fileA, fileB],
    plateMap: { a: fileA, b: fileB },
    files: { a: fileA, b: fileB },
    fileA, fileB,
    a: a.base64, b: b.base64,
    plateA: a.base64, plateB: b.base64,
    base64A: a.base64, base64B: b.base64,
    plateABase64: a.base64, plateBBase64: b.base64,
    inkA: a.base64, inkB: b.base64,
  };
}

export function makeRouter(product, library) {
  const { metadata, demo, render, normalize, renderPlates, proofFromBody } = product;

  async function handlePlates(req, res) {
    const document = normalize(await readDocument(req));
    const plates = renderPlates(document);
    return json(res, { ...platePayload(plates), summary: {
      id: document.id, width: document.width, height: document.height, samples: document.samples,
      layers: plates.layerStats,
    } });
  }

  async function handlePlateProof(req, res) {
    let body = {}, files = {};
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.startsWith('multipart/form-data')) {
      const multipart = await readMultipart(req);
      ({ body, files } = multipartToBody(multipart));
    } else {
      body = await readDocument(req);
    }
    const proof = proofFromBody(body, files);
    const bytes = png(proof.width, proof.height, proof.pixels);
    const base64 = bytes.toString('base64');
    return json(res, {
      width: proof.width, height: proof.height, base64,
      mediaType: 'image/png', type: 'image/png',
      shiftA: proof.shiftA, shiftB: proof.shiftB,
      // Aliases for scripts expecting different response shapes.
      png: base64, proof: base64, pngBase64: base64,
      summary: { width: proof.width, height: proof.height },
    });
  }

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
      if (pathname === '/api/preview') {
        return json(res, {
          summary: rendered.summary,
          base64: rendered.bytes.toString('base64'),
          ...platePayload(rendered.plates),
        });
      }
      const saved = await library.keep(document, rendered);
      return json(res, saved, saved.created ? 201 : 200);
    }

    if (method === 'POST' && ['/api/plates', '/api/plate', '/api/ink-plates', '/api/ink', '/api/spot-plates', '/api/separations', '/api/plate/export', '/api/export/plates'].includes(pathname)) {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new InputError('请求不是来自当前工作台', 403);
      return handlePlates(req, res);
    }

    if (method === 'POST' && ['/api/plate-proof', '/api/proof-plates', '/api/overprint', '/api/overprint-proof', '/api/proof/plates', '/api/plates/proof', '/api/ink-proof', '/api/proof'].includes(pathname)) {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new InputError('请求不是来自当前工作台', 403);
      return handlePlateProof(req, res);
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
