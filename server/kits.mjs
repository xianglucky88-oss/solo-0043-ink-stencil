import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, digest } from './canonical.mjs';
import { publishFile } from './atomic-write.mjs';
import { InputError } from './input.mjs';

const validId = /^[a-f0-9]{64}$/;

// 套件规格摘要：冻结版本标识 + 成品框 + 出血 + 倍率。规格相同即同一份套件，
// 与工作草稿当前内容无关；改变任一输出条件都会得到不同的规格摘要。
export function kitSpecId(version, request) {
  return digest(canonical({ kind: 'tile-kit', version, trim: request.trim, bleed: request.bleed, scale: request.scale }));
}

// 公开元数据：不包含 PNG 字节，只给出可复取链接与各片坐标。
function describe(id, record, basePath) {
  return {
    id,
    version: record.version,
    ...record.manifest,
    manifestUrl: `${basePath}/${id}`,
    tiles: record.manifest.tiles.map(tile => ({ ...tile, url: `${basePath}/${id}/tiles/${tile.index}` })),
  };
}

export async function openKits(directory, { loadSource, build }) {
  await mkdir(directory, { recursive: true });
  const contentFile = id => join(directory, `${id}.json`);
  // 规格摘要 -> 内容摘要（对外链接标识）。内存态；重启后由目录重建。
  const bySpec = new Map();
  // 规格 -> 进行中的承诺。并发同规格请求只做一次像素计算；
  // 失败时承诺被清理，规格不会被占住，印制方可按原条件重试。
  const inflight = new Map();
  let scanPromise = null;

  // 读取套件并做三层核对：文件名=整文件内容摘要、规格锚点、每片字节摘要。
  async function load(id) {
    if (!validId.test(id)) throw new InputError('未知的套件标识', 404);
    let raw;
    try {
      raw = await readFile(contentFile(id));
    } catch (error) {
      if (error.code === 'ENOENT') throw new InputError('套件不存在', 404);
      throw error;
    }
    if (digest(raw) !== id) throw new InputError('套件内容校验失败', 409);
    const envelope = JSON.parse(raw.toString('utf-8'));
    if (envelope.specId !== kitSpecId(envelope.version, envelope.request)) {
      throw new InputError('套件规格不匹配', 409);
    }
    const record = {
      specId: envelope.specId,
      version: envelope.version,
      request: envelope.request,
      manifest: JSON.parse(envelope.manifest),
      assets: JSON.parse(envelope.assets),
    };
    for (const asset of record.assets) {
      if (digest(Buffer.from(asset.base64, 'base64')) !== asset.digest) {
        throw new InputError('套件分片校验失败', 409);
      }
    }
    return record;
  }

  // 重启后扫描目录，用内容文件自带的规格锚点重建映射；损坏或无法解析的文件剔除。
  function scan() {
    scanPromise ??= (async () => {
      const names = (await readdir(directory)).filter(name => name.endsWith('.json'));
      await Promise.all(names.map(async name => {
        const id = name.slice(0, -5);
        if (!validId.test(id)) return;
        try {
          const record = await load(id);
          bySpec.set(record.specId, id);
        } catch (error) {
          // 内容失配或文件无法解析都视为损坏：隔离掉，不让单个坏文件阻断重启复取。
          if (error instanceof InputError) { await rm(contentFile(id), { force: true }); return; }
          throw error;
        }
      }));
    })().finally(() => { scanPromise = null; });
    return scanPromise;
  }

  async function produce(version, request) {
    // 冻结件本身先做完整性核对；草稿不参与套件生产。
    const source = await loadSource(version);
    const { manifest, tiles } = build(source.document, request);
    const specId = kitSpecId(version, request);
    const envelope = {
      specId,
      version,
      request,
      manifest: JSON.stringify(manifest),
      assets: JSON.stringify(tiles.map(tile => ({
        index: tile.index,
        file: tile.file,
        base64: tile.bytes.toString('base64'),
        digest: tile.digest,
      }))),
    };
    const raw = canonical(envelope);
    // 内容寻址：对外标识等于全部交付字节的摘要，任何篡改都会使摘要失配。
    const id = digest(raw);
    // 单文件整体发布：要么整套可见，要么没有链接，绝不会给出半套。
    await publishFile(contentFile(id), raw);
    bySpec.set(specId, id);
    return id;
  }

  return {
    async request(version, request) {
      const specId = kitSpecId(version, request);
      const active = inflight.get(specId);
      if (active) {
        // 同规格进行中：等待同一承诺并标记为复用，绝不重复栅格化。
        const result = await active;
        return { ...result, created: false };
      }
      // 先同步登记承诺再 await，消除并发窗口；扫描与栅格化都在这一个承诺里发生。
      const job = (async () => {
        let known = bySpec.get(specId);
        if (!known) {
          await scan();
          known = bySpec.get(specId);
        }
        if (known) {
          await load(known); // 完整性复核；损坏时返回 409，不静默重算
          return { id: known, created: false };
        }
        return { id: await produce(version, request), created: true };
      })();
      inflight.set(specId, job);
      // 清理分支的回调不抛错，派生承诺只会正常兑现，不会产生未处理拒绝；
      // job 本身的拒绝仍由请求方接收并转成 5xx。
      job.then(() => inflight.delete(specId), () => inflight.delete(specId));
      return job;
    },
    async describe(id, basePath) {
      const record = await load(id);
      return describe(id, record, basePath);
    },
    async tile(id, index) {
      const record = await load(id);
      const entry = record.assets.find(tile => tile.index === index);
      if (!entry) throw new InputError('套件分片不存在', 404);
      const bytes = Buffer.from(entry.base64, 'base64');
      if (digest(bytes) !== entry.digest) throw new InputError('套件分片校验失败', 409);
      return { tile: record.manifest.tiles.find(row => row.index === index), bytes };
    },
  };
}
