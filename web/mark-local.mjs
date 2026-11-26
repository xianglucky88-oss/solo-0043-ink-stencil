// Browser-side, fully local emblem compositing. No network calls and no
// geometry: the mark file already contains the three backdrop plates, so
// swapping backgrounds only evaluates the per-pixel affine response.
import { decodeMark, compositeMark, MARK_TYPE, MARK_SUFFIX } from '../product/mark.mjs';

async function inflateZlib(bytes) {
  if (!('DecompressionStream' in globalThis)) throw new Error('当前浏览器不支持本地解压，无法读取徽记素材');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readMarkFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decodeMark(bytes, inflateZlib);
}

export { MARK_TYPE, MARK_SUFFIX };

// Decodes an 8-bit (or 16-bit, downscaled by the browser) RGBA PNG into
// straight 8-bit pixels. ImageBitmap always exposes ImageData as 8-bit RGBA.
export async function readBackdropPng(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('底图不是可读取的 PNG 图像');
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, pixels: data.data };
  } finally {
    bitmap.close();
  }
}

export function compositeLocally(mark, backdrop) {
  return compositeMark(mark, backdrop);
}

export function encodePngBytes(width, height, rgba) {
  // Reuse the browser's encoder; the output contract is straight RGBA PNG.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  image.data.set(rgba);
  context.putImageData(image, 0, 0);
  return canvas;
}
