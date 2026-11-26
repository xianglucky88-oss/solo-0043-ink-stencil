import assert from 'node:assert/strict';
import { chmod, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

// 解码本项目 PNG 编码器产物，按整幅坐标读 RGBA。
export function decodePng(buffer) {
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  let offset = 8, raw = Buffer.alloc(0);
  while (offset < buffer.length) {
    const size = buffer.readUInt32BE(offset);
    const tag = buffer.toString('ascii', offset + 4, offset + 8);
    if (tag === 'IDAT') raw = Buffer.concat([raw, inflateSync(buffer.subarray(offset + 8, offset + 8 + size))]);
    offset += 12 + size;
  }
  const stride = width * 4 + 1;
  return { width, height, at: (x, y) => Array.from(raw.subarray(y * stride + 1 + x * 4, y * stride + 5 + x * 4)) };
}

const tiny = (id, shape = { kind: 'rect', w: 64, h: 64, radius: 0 }) => ({
  id, width: 64, height: 64, samples: 1,
  layers: [{
    id: 'ink', shape, transform: { x: 32, y: 32, rotation: 0 },
    color: '#3366ff', opacity: 1, blend: 'normal', mask: null, visible: true,
  }],
});

export function kitChecks({ storage, restart, get, post, read }) {
  const kits = '/api/kits';
  const freeze = async document => {
    const response = await post('/api/library', document);
    assert.ok([200, 201].includes(response.status));
    return (await response.json()).id;
  };
  const order = async body => {
    const response = await post(kits, body);
    assert.ok([200, 201].includes(response.status), `套件下单返回 ${response.status}`);
    return response.json();
  };
  const tileBytes = async (kit, index) => Buffer.from(await (await get(kit.tiles[index].url)).arrayBuffer());

  // 下载整套并按清单坐标拼回整幅 RGBA。
  async function assemble(kit) {
    const canvas = new Uint8Array(kit.size.width * kit.size.height * 4);
    for (const tile of kit.tiles) {
      const image = decodePng(Buffer.from(await (await get(tile.url)).arrayBuffer()));
      assert.equal(image.width, tile.width);
      assert.equal(image.height, tile.height);
      for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
        canvas.set(image.at(x, y), ((tile.y + y) * kit.size.width + (tile.x + x)) * 4);
      }
    }
    return canvas;
  }

  return {
    // 分幅几何：成品框、出血、倍率、512 上限、无缺口无重叠、拼接还原。
    kitGeometry: async () => {
      const version = await freeze(tiny('geo'));
      const kit = await order({ version, trim: { x: 0, y: 0, w: 512, h: 512 }, bleed: 32, scale: 2 });
      assert.equal(kit.size.width, 1152);
      assert.equal(kit.size.height, 1152);
      assert.deepEqual(kit.frame, { x: 64, y: 64, w: 1024, h: 1024 });
      assert.ok(kit.tiles.length > 1);
      assert.ok(kit.tiles.every(t => Math.max(t.width, t.height) <= 512));
      const covered = new Set();
      for (const t of kit.tiles) {
        for (let y = t.y; y < t.y + t.height; y++) for (let x = t.x; x < t.x + t.width; x++) {
          const key = `${x}:${y}`;
          assert.ok(!covered.has(key), `分片在 ${key} 重叠`);
          covered.add(key);
        }
        assert.equal(t.file, `tile-${String(t.index).padStart(2, '0')}.png`);
      }
      assert.equal(covered.size, 1152 * 1152);
      const canvas = await assemble(kit);
      // 清单坐标、片尺寸与实际 PNG 完全对齐。
      assert.equal(canvas.length, 1152 * 1152 * 4);
    },

    // 成品框内与整幅栅格逐像素一致；旧画布外真正无内容处保持透明。
    kitContent: async () => {
      const document = tiny('content');
      const version = await freeze(document);
      const kit = await order({ version, trim: { x: 0, y: 0, w: 64, h: 64 }, bleed: 8, scale: 1 });
      const canvas = await assemble(kit);
      const full = decodePng(Buffer.from((await read(await post('/api/preview', document))).base64, 'base64'));
      let mismatches = 0;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const got = Array.from(canvas.slice(((y + 8) * 80 + (x + 8)) * 4, ((y + 8) * 80 + (x + 8)) * 4 + 4));
        if (got.join() !== full.at(x, y).join()) mismatches++;
      }
      assert.equal(mismatches, 0);
      assert.deepEqual(Array.from(canvas.slice(0, 4)), [0, 0, 0, 0]);
      // 成品框完全落在旧画布外：全部透明而非报错。
      const outside = await order({ version, trim: { x: 200, y: 200, w: 32, h: 32 }, bleed: 4, scale: 1 });
      const image = decodePng(await tileBytes(outside, 0));
      assert.deepEqual(image.at(0, 0), [0, 0, 0, 0]);
      assert.equal(image.at(39, 39)[3], 0);
    },

    // 两倍件是原生栅格：一倍边缘只有 0/255，两倍斜边出现中间 alpha，不可能由放大得到。
    kitNativeScale: async () => {
      const version = await freeze(tiny('diag', { kind: 'diamond', w: 400, h: 400 }));
      const spec = { version, trim: { x: 0, y: 0, w: 512, h: 512 }, bleed: 0 };
      const one = await order({ ...spec, scale: 1 });
      const two = await order({ ...spec, scale: 2 });
      assert.notEqual(one.id, two.id);
      assert.equal(one.size.width, 512);
      assert.equal(two.size.width, 1024);
      const oneImage = decodePng(await tileBytes(one, 0));
      const twoCanvas = await assemble(two);
      let partialOne = 0, partialTwo = 0;
      for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
        const a1 = oneImage.at(x, y)[3];
        if (a1 > 0 && a1 < 255) partialOne++;
        const a2 = twoCanvas[(y * 1024 + x) * 4 + 3];
        if (a2 > 0 && a2 < 255) partialTwo++;
      }
      assert.equal(partialOne, 0);
      assert.ok(partialTwo > 100, '两倍件缺少原生子像素边缘');
      // 跨垂直片缝的相邻列不应出现采样断层。
      let jumps = 0;
      for (let y = 0; y < 1024; y++) {
        const a = twoCanvas[(y * 1024 + 511) * 4 + 3], b = twoCanvas[(y * 1024 + 512) * 4 + 3];
        if (a !== 0 && b !== 0 && Math.abs(a - b) > 64) jumps++;
      }
      assert.equal(jumps, 0, '片缝出现采样错位');
    },

    // 预算按整幅输出 × 采样² × 图层核算，切小片不能绕过；非法参数拒绝。
    kitBudget: async () => {
      const version = await freeze(tiny('budget'));
      // 1424² × 4 子样 × 16 层远超 8,000,000，即使每片仍小于 512 也必须整体拒绝。
      const dense = tiny('budget-dense');
      dense.samples = 2;
      while (dense.layers.length < 16) {
        const n = dense.layers.length;
        dense.layers.push({ ...dense.layers[0], id: `ink-${n}`, color: n % 2 ? '#3366ff' : '#ff6633' });
      }
      const denseVersion = await freeze(dense);
      await read(await post(kits, {
        version: denseVersion, trim: { x: 0, y: 0, w: 512, h: 512 }, bleed: 100, scale: 2,
      }), 422);
      await read(await post(kits, { version, trim: { x: 0, y: 0, w: 0, h: 10 }, bleed: 0, scale: 1 }), 422);
      await read(await post(kits, { version, trim: { x: 0, y: 0, w: 10, h: 10 }, bleed: -1, scale: 1 }), 422);
      await read(await post(kits, { version, trim: { x: 0, y: 0, w: 10, h: 10 }, bleed: 0, scale: 3 }), 422);
      await read(await post(kits, {
        version: 'a'.repeat(64), trim: { x: 0, y: 0, w: 10, h: 10 }, bleed: 0, scale: 1,
      }), 404);
      // 同一份密集文档的合规小规格仍应成功，证明限制来自预算而非图层数本身。
      await order({ version: denseVersion, trim: { x: 0, y: 0, w: 16, h: 16 }, bleed: 0, scale: 1 });
    },

    // 同规格并发只栅格化一次；重复请求与重启后复取都返回原链接，不再产出新文件。
    kitDedup: async () => {
      const version = await freeze(tiny('dedup'));
      const body = { version, trim: { x: 0, y: 0, w: 64, h: 64 }, bleed: 8, scale: 1 };
      const responses = await Promise.all([post(kits, body), post(kits, body), post(kits, body)]);
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 200, 201]);
      const records = await Promise.all(responses.map(r => r.json()));
      assert.equal(new Set(records.map(r => r.id)).size, 1);
      const id = records[0].id;
      const directory = join(storage, 'kits');
      assert.deepEqual((await readdir(directory)).filter(name => name === `${id}.json`), [`${id}.json`]);
      const before = await stat(join(directory, `${id}.json`));
      await restart();
      const reopened = await read(await get(`${kits}/${id}`));
      assert.equal(reopened.id, id);
      assert.equal((await stat(join(directory, `${id}.json`))).mtimeMs, before.mtimeMs);
      const again = await read(await post(kits, body), 200);
      assert.equal(again.id, id);
      // 改变任一输出条件或冻结版本都得到不同套件。
      const changed = await order({ ...body, bleed: 9 });
      assert.notEqual(changed.id, id);
      const other = await freeze(tiny('dedup-other'));
      assert.notEqual((await order({ ...body, version: other })).id, id);
    },

    // 失败不给半套链接、不占规格；恢复后按原条件重试成功。
    kitRetry: async () => {
      const version = await freeze(tiny('retry'));
      const body = { version, trim: { x: 0, y: 0, w: 32, h: 32 }, bleed: 0, scale: 1 };
      const directory = join(storage, 'kits');
      await restart({ readonlyKits: true });
      await read(await post(kits, body), 500);
      assert.ok((await readdir(directory)).every(name => !name.includes('.part')));
      await restart();
      const kit = await read(await post(kits, body), 201);
      assert.equal((await get(kit.tiles[0].url)).status, 200);
    },

    // 完整性：篡改套件文件返回 409；原冻结件与原始 PNG 下载照常可用。
    kitIntegrity: async () => {
      const version = await freeze(tiny('integrity'));
      const kit = await order({ version, trim: { x: 0, y: 0, w: 32, h: 32 }, bleed: 0, scale: 1 });
      const path = join(storage, 'kits', `${kit.id}.json`);
      await writeFile(path, Buffer.concat([await readFile(path), Buffer.from(' ')]));
      await read(await get(`${kits}/${kit.id}`), 409);
      await read(await get(kit.tiles[0].url), 409);
      assert.equal((await get(`/api/library/${version}/asset`)).status, 200);
      await rm(path, { force: true });
    },
  };
}

// 让工作流在权限受限的套件目录与正常目录之间切换，模拟一次发布故障。
export function makeRestart(start, close, storage) {
  return async ({ readonlyKits = false } = {}) => {
    await close();
    await start();
    if (readonlyKits) await chmod(join(storage, 'kits'), 0o500);
    else await chmod(join(storage, 'kits'), 0o700);
  };
}
