import { writeFile, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function publishFile(path, content) {
  const temporary = `${path}.${randomUUID()}.part`;
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    // Publish a complete file and never replace a concurrent publication.
    await link(temporary, path);
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return false;
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
