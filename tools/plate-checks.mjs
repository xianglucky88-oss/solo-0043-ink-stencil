import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { normalize } from '../product/document.mjs';
import { rasterPlates, compositeProof, inkByte } from '../product/plates.mjs';
import { grayPng } from '../product/png.mjs';

// Independent grayscale PNG reader for check assertions (does not import the
// product decoder, so encoder/decoder bugs cannot mask each other).
function grayReader(base64) {
  const png = Buffer.from(base64, 'base64');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.equal(png[24], 8, '位深必须为 8');
  assert.equal(png[25], 0, '颜色类型必须为灰度 0');
  assert.equal(png[28], 0, '必须非隔行');
  let offset = 8, idat = [];
  while (offset + 8 <= png.length) {
    const len = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + len));
    if (type === 'IEND') break;
    offset += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width;
  return {
    width, height,
    at(x, y) {
      const row = y * (stride + 1);
      assert.equal(raw[row], 0, '自检夹具使用 filter 0');
      return raw[row + 1 + x];
    },
  };
}

function rgbaReader(base64) {
  const png = Buffer.from(base64, 'base64');
  const width = png.readUInt32BE(16);
  const raw = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));
  return (x, y) => Array.from(raw.subarray(y * (width * 4 + 1) + 1 + x * 4, y * (width * 4 + 1) + 5 + x * 4));
}

// The spec's numeric fixture: a hidden trim clip leaves exactly the same
// half (one sample column of two) of one pixel for both strokes.
function oracleDocument(upperMode) {
  return {
    id: 'half-sample-oracle', width: 32, height: 32, samples: 2,
    layers: [
      { id: 'trim', shape: { kind: 'rect', w: 2, h: 4, radius: 0 }, transform: { x: 15.5, y: 16.5 }, color: '#ffffff', opacity: 1, blend: 'normal', mask: null, visible: false },
      { id: 'base', shape: { kind: 'rect', w: 4, h: 4, radius: 0 }, transform: { x: 16.5, y: 16.5 }, color: '#21434d', opacity: 1, blend: 'multiply', mask: 'trim', visible: true, plate: 'a', overprint: true },
      { id: 'upper', shape: { kind: 'rect', w: 4, h: 4, radius: 0 }, transform: { x: 16.5, y: 16.5 }, color: '#000000', opacity: 0.5, blend: 'screen', mask: 'trim', visible: true, plate: 'b', overprint: upperMode === 'overprint' },
    ],
  };
}

export function plateChecks({ preview, read, send }) {
  const postJson = async (path, body) => read(await send(path, body));
  const rejected = async (responsePromise, status = 422) => read(await responsePromise, status);
  return {
    plate: async () => {
      // ---- Pure math oracle -------------------------------------------
      for (const [mode, expected] of [['overprint', [128, 64]], ['knockout', [64, 64]]]) {
        const doc = normalize(oracleDocument(mode));
        const result = rasterPlates(doc);
        const index = 16 * 32 + 16;
        assert.equal(result.gray[0][index], expected[0], `${mode} A 版`);
        assert.equal(result.gray[1][index], expected[1], `${mode} B 版`);
      }
      // Half-up rounding at the exact 127.5 tie goes to 128.
      assert.equal(inkByte(0.5), 128);
      assert.equal(inkByte(0.25), 64);
      assert.equal(inkByte(0), 0);
      assert.equal(inkByte(1), 255);

      // Unassigned layers deposit no ink even when visible; screen color and
      // blend mode never decide plate assignment.
      const unassigned = normalize({
        id: 'none', width: 16, height: 16, samples: 1,
        layers: [{ id: 'solo', shape: { kind: 'rect', w: 4, h: 4 }, transform: { x: 8, y: 8 }, color: '#ff00ff', opacity: 1, blend: 'screen', mask: null, visible: true }],
      });
      const empty = rasterPlates(unassigned);
      assert.equal(empty.gray[0].some((v) => v !== 0), false);
      assert.equal(empty.gray[1].some((v) => v !== 0), false);

      // ---- HTTP plate generation via the existing preview route -------
      const response = await preview(oracleDocument('overprint'));
      const b64a = response.plateABase64 ?? response.plateA ?? response.a ?? response.plateStrings[0];
      const b64b = response.plateBBase64 ?? response.plateB ?? response.b ?? response.plateStrings[1];
      assert.ok(b64a && b64b, 'preview 须返回两张墨版 base64');
      const plateA = grayReader(b64a), plateB = grayReader(b64b);
      assert.equal(plateA.width, 32); assert.equal(plateA.height, 32);
      assert.equal(plateB.width, 32); assert.equal(plateB.height, 32);
      assert.equal(plateA.at(16, 16), 128);
      assert.equal(plateB.at(16, 16), 64);

      // Dedicated endpoint agrees.
      const platesResponse = await postJson('/api/plates', oracleDocument('knockout'));
      const kA = grayReader(platesResponse.plateABase64 ?? platesResponse.plateA ?? platesResponse.a);
      assert.equal(kA.at(16, 16), 64);

      // ---- File-based white paper proof -------------------------------
      const w = 4;
      const full = Buffer.from([255, 255, 0, 0]);
      const half = Buffer.from([128, 0, 255, 0]);
      const proofResponse = await postJson('/api/plate-proof', {
        a: grayPng(w, 1, full).toString('base64'),
        b: grayPng(w, 1, half).toString('base64'),
        colorA: '#ff0000', colorB: '#0000ff',
      });
      assert.equal(proofResponse.width, w);
      const px = rgbaReader(proofResponse.base64);
      // x0: A=255 red (1,0,0), B=128 blue whose normalized ramp is
      // (127/255,127/255,1); channel product is (127/255,0,0).
      assert.deepEqual(px(0, 0), [127, 0, 0, 255]);
      // x1: A=255 red, B=0 -> pure red.
      assert.deepEqual(px(1, 0), [255, 0, 0, 255]);
      // x2: A=0 white, B=255 blue -> pure blue.
      assert.deepEqual(px(2, 0), [0, 0, 255, 255]);
      // x3: both 0 -> paper white.
      assert.deepEqual(px(3, 0), [255, 255, 255, 255]);

      // Shift A right by one whole pixel: x0 reads outside plate A (no ink),
      // x1 reads A's first byte (255 under black simulation ink).
      const shifted = await postJson('/api/plate-proof', {
        a: grayPng(2, 1, Buffer.from([255, 0])).toString('base64'),
        b: grayPng(2, 1, Buffer.alloc(2)).toString('base64'),
        colorA: '#000000', shiftA: { dx: 1, dy: 0 },
      });
      const spx = rgbaReader(shifted.base64);
      assert.deepEqual(spx(0, 0), [255, 255, 255, 255]);
      assert.deepEqual(spx(1, 0), [0, 0, 0, 255]);

      // Replacing a same-spec plate changes overlap at the same pixels.
      const replaced = await postJson('/api/plate-proof', {
        a: grayPng(1, 1, Buffer.from([255])).toString('base64'),
        b: grayPng(1, 1, Buffer.from([255])).toString('base64'),
        colorA: '#ff0000', colorB: '#ffff00',
      });
      // red (1,0,0) * yellow (1,1,0) = (1,0,0).
      assert.deepEqual(rgbaReader(replaced.base64)(0, 0), [255, 0, 0, 255]);

      // Mismatched dimensions and non-plate uploads must not produce a proof.
      await rejected(send('/api/plate-proof', {
        a: grayPng(2, 2, Buffer.alloc(4)).toString('base64'),
        b: grayPng(3, 2, Buffer.alloc(6)).toString('base64'),
      }));
      await rejected(send('/api/plate-proof', {
        a: 'not-a-png',
        b: grayPng(1, 1, Buffer.alloc(1)).toString('base64'),
      }));

      // Pure proof function rejects mismatched sizes with 不一致 wording.
      assert.throws(() => compositeProof({
        plateA: { width: 2, height: 2, gray: Buffer.alloc(4) },
        plateB: { width: 3, height: 2, gray: Buffer.alloc(6) },
      }), /不一致/);
    },
  };
}

// Allow `node tools/plate-checks.mjs` to run the suite standalone. When the
// platform workflow harness imports this module it only uses the factory.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { start } = await import('../server.mjs');
  const storage = await mkdtemp(join(tmpdir(), 'plate-check-'));
  const server = await start({ port: 0, storage });
  const port = server.address().port;
  const get = (path, options) => fetch(`http://127.0.0.1:${port}${path}`, options);
  const send = (path, body) => get(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const read = async (response, status = 200) => {
    const json = await response.json();
    assert.equal(response.status, status, JSON.stringify(json).slice(0, 240));
    return json;
  };
  try {
    const { document } = await read(await get('/api/demo'));
    const preview = async (doc = document) => read(await send('/api/preview', doc));
    const checks = plateChecks({ document, preview, read, send, get });
    await checks.plate();
    console.log('Standalone plate checks: OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(storage, { recursive: true, force: true });
  }
}
