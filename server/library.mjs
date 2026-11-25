import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, digest } from './canonical.mjs';
import { publishFile } from './atomic-write.mjs';
import { InputError } from './input.mjs';

const validId = /^[a-f0-9]{64}$/;

export async function openLibrary(directory, metadata) {
  await mkdir(directory, { recursive: true });
  const file = id => join(directory, `${id}.json`);
  async function load(id) {
    if (!validId.test(id)) throw new InputError('未知的版本标识', 404);
    try {
      const raw = await readFile(file(id));
      if (digest(raw) !== id) throw new InputError('版本内容校验失败', 409);
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') throw new InputError('版本不存在', 404);
      throw error;
    }
  }
  return {
    load,
    async keep(document, rendered) {
      const raw = canonical({ version: metadata.version, document, summary: rendered.summary, base64: rendered.bytes.toString('base64') });
      const id = digest(raw);
      const created = await publishFile(file(id), raw);
      if (!created) await load(id);
      return { id, summary: rendered.summary, created };
    },
    async recent() {
      const filenames = (await readdir(directory)).filter(name => validId.test(name.slice(0,-5)) && name.endsWith('.json'));
      const times = await Promise.all(filenames.map(async name => ({
        id: name.slice(0,-5), time: (await stat(join(directory, name))).mtimeMs,
      })));
      return times.sort((a,b) => b.time-a.time || a.id.localeCompare(b.id)).slice(0,20);
    },
  };
}
