import { readDocument } from './request-body.mjs';
import { json, send } from './responses.mjs';
import { servePage } from './static.mjs';
import { InputError } from './input.mjs';

const tileExportPattern = /^(tile|repeat|pattern)/;

async function sendLibraryTile(res, library, normalize, renderTile, id, metadata, searchParams) {
  const record = await library.load(id);
  // Tiles are always rebuilt from the canonical vector document with its
  // original sampling. Never derive them from the cropped proof PNG.
  const tile = renderTile(normalize(record.document));
  if (searchParams.get('format') === 'json' || searchParams.get('base64') === '1') {
    return json(res, { summary: tile.summary, base64: tile.bytes.toString('base64') });
  }
  return send(res, 200, tile.bytes, metadata.asset, {
    'Content-Disposition': `attachment; filename="${metadata.slug}-${id.slice(0, 12)}-tile.${metadata.suffix}"`,
  });
}

export function makeRouter(product, library) {
  const { metadata, demo, render, renderTile, normalize } = product;
  return async function route(req, res) {
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    const method = req.method;
    if (method === 'GET' && !pathname.startsWith('/api/')) return servePage(pathname, res);
    if (method === 'GET' && pathname === '/api/demo') return json(res, { metadata, document: demo() });
    if (method === 'GET' && pathname === '/api/library') return json(res, await library.recent());
    if (method === 'POST' && ['/api/preview', '/api/tile', '/api/library'].includes(pathname)) {
      // A browser hosted elsewhere cannot mutate the local project store.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new InputError('请求不是来自当前工作台', 403);
      const input=await readDocument(req);
      const document = normalize(input);
      if (pathname === '/api/tile') {
        const rendered = renderTile(document);
        if (searchParams.get('format') === 'png' || searchParams.has('download')) {
          return send(res,200,rendered.bytes,metadata.asset,{
            'Content-Disposition': `attachment; filename="${metadata.slug}-tile.${metadata.suffix}"`,
          });
        }
        return json(res, { summary: rendered.summary, base64: rendered.bytes.toString('base64') });
      }
      const rendered = render(document);
      if (pathname === '/api/preview') {
        const previewRendered = input.variant === 'tile' || input.export === 'tile' || input.tile === true
          ? renderTile(document)
          : rendered;
        return json(res, { summary: previewRendered.summary, base64: previewRendered.bytes.toString('base64') });
      }
      const saved = await library.keep(document, rendered);
      return json(res, saved, saved.created ? 201 : 200);
    }
    const postTileMatch = /^\/api\/library\/([a-f0-9]{64})\/(?:export|exports|asset|assets|file|files)?\/?(tile(?:\.png)?|repeat(?:\.png)?|pattern(?:\.png)?)$/.exec(pathname);
    if (method === 'POST' && postTileMatch) {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new InputError('请求不是来自当前工作台', 403);
      req.resume();
      return sendLibraryTile(res, library, normalize, renderTile, postTileMatch[1], metadata, searchParams);
    }
    const exportMatch = /^\/api\/library\/([a-f0-9]{64})\/(?:export|exports|asset|assets|file|files)\/(tile(?:\.png)?|repeat(?:\.png)?|pattern(?:\.png)?)$/.exec(pathname);
    if (method === 'GET' && exportMatch) {
      return sendLibraryTile(res, library, normalize, renderTile, exportMatch[1], metadata, searchParams);
    }
    const match = /^\/api\/library\/([a-f0-9]{64})(?:\/(asset|tile(?:\.png)?|tile-asset|tile-image|repeat(?:\.png)?|pattern(?:\.png)?|pattern-asset))?$/.exec(pathname);
    if (method === 'GET' && match) {
      const { base64, ...record } = await library.load(match[1]);
      const tileVariant = searchParams.get('variant') ?? searchParams.get('kind') ?? searchParams.get('asset') ?? searchParams.get('file') ?? searchParams.get('name') ?? '';
      const tileFlagName = ['tile', 'repeat', 'pattern'].find((name) => searchParams.has(name));
      const tileFlag = tileFlagName ? searchParams.get(tileFlagName) : null;
      const isTile = tileExportPattern.test(match[2] ?? '')
        || /tile|repeat|pattern/.test(tileVariant)
        || (tileFlagName !== undefined && !['0', 'false'].includes(tileFlag));
      if (!match[2]) return json(res, record);
      if (isTile) {
        return sendLibraryTile(res, library, normalize, renderTile, match[1], metadata, searchParams);
      }
      return send(res, 200, Buffer.from(base64, 'base64'), metadata.asset, {
        'Content-Disposition': `attachment; filename="${metadata.slug}-${match[1].slice(0,12)}.${metadata.suffix}"`,
      });
    }
    throw new InputError('接口不存在', 404);
  };
}
