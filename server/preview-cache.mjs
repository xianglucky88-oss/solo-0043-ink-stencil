import { canonical, digest } from '../server/canonical.mjs';

// Preview state is in-memory only and never written to the version library.
// A cache hit lets the next submission repaint just the moved mask region;
// misses simply fall back to a full render with no correctness impact. Each
// entry holds one width*height*4 buffer (max 1 MiB at the 512 px budget).
export function openPreviewCache(limit=64) {
  const entries=new Map();
  const key=document=>digest(canonical(document));
  return {
    key,
    get(document) {
      const id=key(document);
      const entry=entries.get(id);
      if (!entry) return null;
      entries.delete(id); entries.set(id,entry);
      return entry;
    },
    put(entry) {
      const id=entry.key;
      if (entries.has(id)) entries.delete(id);
      entries.set(id,entry);
      while (entries.size>limit) entries.delete(entries.keys().next().value);
      return id;
    },
  };
}
