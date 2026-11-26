import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { png } from '../product/png.mjs';

// End-to-end acceptance for PNG -> editable vector recovery. Runs against the
// real HTTP routes with a temporary library, exactly like tools/workflow.mjs.

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const tag = Buffer.from(type, 'ascii');
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([tag, data])) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  const crcBuffer = Buffer.alloc(4); crcBuffer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, tag, data, crcBuffer]);
}
const withChunks = (base, ...extras) => Buffer.concat([base.subarray(0, 33), ...extras, base.subarray(33)]);
const srgb = () => chunk('sRGB', Buffer.from([0]));
const iccpNonSrgb = () => chunk('iCCP', Buffer.concat([Buffer.from('Display P3'), Buffer.from([0, 0]), deflateSync(Buffer.from('DISPLAY P3 FAKE PROFILE'))]));

function decodePngPixels(base64) {
  const buffer = Buffer.from(base64, 'base64');
  const width = buffer.readUInt32BE(16);
  let offset = 8; const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (buffer.toString('ascii', offset + 4, offset + 8) === 'IDAT') idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return (x, y) => Array.from(raw.subarray(y * (width * 4 + 1) + 1 + x * 4, y * (width * 4 + 1) + 5 + x * 4));
}

function makeLogo() {
  const W = 48, H = 48, pixels = Buffer.alloc(W * H * 4);
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
  };
  const red = [214, 58, 58], blue = [40, 96, 200];
  for (let y = 4; y < 20; y++) for (let x = 4; x < 20; x++) {
    if (!(x >= 8 && x < 16 && y >= 8 && y < 16)) put(x, y, red);
  }
  let count = 0;
  for (let y = 30; y < 46 && count < 17; y += 3) {
    for (let x = 2; x < 46 && count < 17; x += 3) { put(x, y, red); count++; }
  }
  put(40, 4, red); put(41, 5, red); // corner contact only -> two pieces
  for (let y = 24; y < 28; y++) for (let x = 30; x < 36; x++) put(x, y, blue);
  const i = 0; pixels[i] = 9; pixels[i + 1] = 8; pixels[i + 2] = 7; pixels[i + 3] = 0; // hidden RGB
  return { W, H, pixels, bytes: png(W, H, pixels) };
}

export function recoveryChecks({ get, read, save }) {
  return {
    recover: async () => {
      const logo = makeLogo();
      const srgbBytes = withChunks(logo.bytes, srgb());
      const nonSrgbBytes = withChunks(logo.bytes, iccpNonSrgb());

      const upload = async (path, bytes) => {
        const response = await get(path, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes });
        return read(response, response.status === 422 ? 422 : 200).then(async body => ({ status: response.status, body }));
      };

      // No-declaration and sRGB-declared pixel-identical PNGs recover equally.
      const none = await upload('/api/recover', logo.bytes);
      assert.equal(none.status, 200);
      const declared = await upload('/api/recover', srgbBytes);
      assert.equal(declared.status, 200);
      assert.deepEqual(declared.body.document, none.body.document);
      const document = none.body.document;
      assert.equal(document.width, logo.W); assert.equal(document.height, logo.H);
      assert.equal(document.layers.length, 2);

      const red = document.layers.find(l => l.color === '#d63a3a');
      const blue = document.layers.find(l => l.color === '#2860c8');
      assert.ok(red && blue);
      assert.equal(red.shape.pieces.length, 20); // ring + 17 islands + corner pair
      assert.equal(red.shape.pieces.filter(p => p.holes.length === 1).length, 1);
      assert.equal(blue.shape.pieces.length, 1);

      // Exact reproduction at both sample grids.
      for (const samples of [1, 2]) {
        const response = await get('/api/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...document, samples }),
        });
        const preview = await read(response);
        const pixel = decodePngPixels(preview.base64);
        let mismatches = 0;
        for (let y = 0; y < logo.H; y++) for (let x = 0; x < logo.W; x++) {
          const i = (y * logo.W + x) * 4;
          const expected = [logo.pixels[i], logo.pixels[i + 1], logo.pixels[i + 2], logo.pixels[i + 3]];
          const actual = pixel(x, y);
          if (expected[3] === 0 ? actual[3] !== 0 : JSON.stringify(actual) !== JSON.stringify(expected)) mismatches++;
        }
        assert.equal(mismatches, 0, `samples=${samples} 未逐像素复现`);
      }

      // Explicit non-sRGB is rejected with a reason.
      const rejected = await upload('/api/recover', nonSrgbBytes);
      assert.equal(rejected.status, 422);
      assert.match(rejected.body.error, /sRGB|ICC|颜色/);

      // A recovered draft freezes and reopens without the source PNG.
      const saved = await save(document, 201);
      const record = await read(await get(`/api/library/${saved.id}`));
      assert.equal(record.document.layers[0].shape.kind, 'contours');
      await read(await get('/api/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...record.document, samples: 2 }),
      }));

      // Holes and inter-piece gaps clip transparent through a hidden mask.
      const masked = structuredClone(document);
      const maskLayer = masked.layers.find(l => l.color === '#d63a3a');
      maskLayer.visible = false;
      masked.layers = [maskLayer, {
        id: 'ink-fill', shape: { kind: 'rect', w: logo.W, h: logo.H, radius: 0 },
        transform: { x: logo.W / 2, y: logo.H / 2 }, color: '#2860c8',
        opacity: 1, blend: 'normal', mask: maskLayer.id, visible: true,
      }];
      const maskedPreview = await read(await get('/api/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(masked),
      }));
      const pixel = decodePngPixels(maskedPreview.base64);
      assert.equal(pixel(12, 12)[3], 0); // hole
      assert.equal(pixel(30, 30)[3], 0); // gap between pieces
      assert.equal(pixel(10, 5)[3], 255); // ring wall

      // Independent piece boundary edits and whole-layer transforms are accepted.
      const edited = structuredClone(document);
      const editRed = edited.layers.find(l => l.color === '#d63a3a');
      const untouched = JSON.stringify(editRed.shape.pieces[8]);
      editRed.shape.pieces[0].points = editRed.shape.pieces[0].points.map(([x, y]) => [x + 2, y]);
      editRed.shape.pieces[0].rings = [editRed.shape.pieces[0].points, ...editRed.shape.pieces[0].holes];
      assert.equal(JSON.stringify(editRed.shape.pieces[8]), untouched);
      editRed.transform.rotation = 31; editRed.transform.sx = 1.8; editRed.transform.sy = 0.7;
      editRed.color = '#00aa44';
      await read(await get('/api/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...edited, samples: 2 }),
      }));
    },
  };
}
