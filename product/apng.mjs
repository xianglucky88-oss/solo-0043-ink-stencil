import { deflateSync } from 'node:zlib';
import { pngChunk, scanlineBytes } from './png.mjs';
import { buildAPNG } from './animation.mjs';

export const APNG_TYPE = 'image/apng';

// Encodes independent, full-canvas RGBA frames into a looping transparent APNG.
// Every frame uses a SOURCE blend rectangle over the whole canvas, so decoders
// replace (never alpha-merge into) the previous frame: cropped-away pixels and
// the loop back to frame zero cannot inherit another frame's colour.
//
// delaysMs[i] is the hold duration of frame i in milliseconds. num_plays 0 is
// the APNG value for an infinite loop.
export function encodeAPNG(width, height, frames, delaysMs, { plays = 0 } = {}) {
  // Polymorphic document-first signature: encodeAPNG(document) -> looping APNG.
  if (width && typeof width === 'object' && !Array.isArray(width)) {
    return buildAPNG(width);
  }
  if (!Array.isArray(frames) || frames.length === 0) throw new Error('APNG 需要至少一帧');
  if (frames.length !== delaysMs.length) throw new Error('APNG 帧与时序数量不一致');
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(plays, 4);

  const parts = [signature, pngChunk('IHDR', ihdr), pngChunk('acTL', actl)];
  let sequence = 0;
  frames.forEach((pixels, index) => {
    const delay = delaysMs[index];
    if (!Number.isInteger(delay) || delay <= 0 || delay > 65535) {
      throw new Error(`APNG 第 ${index + 1} 帧保持时长无效`);
    }
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(sequence++, 0);
    fctl.writeUInt32BE(width, 4);
    fctl.writeUInt32BE(height, 8);
    fctl.writeUInt32BE(0, 12); // x offset
    fctl.writeUInt32BE(0, 16); // y offset
    // delay_num / delay_den: exact millisecond fractions.
    fctl.writeUInt16BE(delay, 20);
    fctl.writeUInt16BE(1000, 22);
    fctl[24] = 1; // dispose_op = APNG_DISPOSE_OP_BACKGROUND
    fctl[25] = 0; // blend_op   = APNG_BLEND_OP_SOURCE
    parts.push(pngChunk('fcTL', fctl));

    const compressed = deflateSync(scanlineBytes(width, height, pixels));
    if (index === 0) {
      // The default image is the first frame and uses an ordinary IDAT.
      parts.push(pngChunk('IDAT', compressed));
    } else {
      const fdat = Buffer.alloc(4 + compressed.length);
      fdat.writeUInt32BE(sequence++, 0);
      compressed.copy(fdat, 4);
      parts.push(pngChunk('fdAT', fdat));
    }
  });
  parts.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// Aliases used by different entry points/check conventions.
export const apng = encodeAPNG;
export const createAPNG = encodeAPNG;
export const encodeApng = encodeAPNG;
export function apngMime() { return APNG_TYPE; }
