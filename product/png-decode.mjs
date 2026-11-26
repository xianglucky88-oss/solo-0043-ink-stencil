import { inflateSync } from 'node:zlib';

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readChunks(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('不是有效的 PNG');
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    chunks.push({ type, data: buffer.subarray(dataStart, dataStart + length) });
    offset = dataStart + length + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}

export function decodePNG(buffer) {
  const chunks = readChunks(buffer);
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR');
  if (!ihdr || ihdr.data.length < 13) throw new Error('PNG 缺少 IHDR');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  if (bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType)) throw new Error('仅支持 8 位灰度/RGB/RGBA PNG');
  const sourceChannels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const stride = width * sourceChannels;
  const raw = inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data)));
  const expected = height * (stride + 1);
  if (raw.length < expected) throw new Error('PNG 图像数据不完整');

  const unfiltered = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawOffset++];
    const rowStart = y * stride;
    const previousStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const current = raw[rawOffset++];
      const left = x >= sourceChannels ? unfiltered[rowStart + x - sourceChannels] : 0;
      const above = y > 0 ? unfiltered[previousStart + x] : 0;
      const upperLeft = y > 0 && x >= sourceChannels ? unfiltered[previousStart + x - sourceChannels] : 0;
      let value;
      if (filter === 0) value = current;
      else if (filter === 1) value = current + left;
      else if (filter === 2) value = current + above;
      else if (filter === 3) value = current + ((left + above) >> 1);
      else if (filter === 4) value = current + paeth(left, above, upperLeft);
      else throw new Error(`不支持的 PNG 过滤器 ${filter}`);
      unfiltered[rowStart + x] = value & 255;
    }
  }

  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const source = i * sourceChannels;
    const target = i * 4;
    if (colorType === 6) {
      data[target] = unfiltered[source];
      data[target + 1] = unfiltered[source + 1];
      data[target + 2] = unfiltered[source + 2];
      data[target + 3] = unfiltered[source + 3];
    } else if (colorType === 2) {
      data[target] = unfiltered[source];
      data[target + 1] = unfiltered[source + 1];
      data[target + 2] = unfiltered[source + 2];
      data[target + 3] = 255;
    } else if (colorType === 0) {
      data[target] = data[target + 1] = data[target + 2] = unfiltered[source];
      data[target + 3] = 255;
    } else {
      data[target] = data[target + 1] = data[target + 2] = unfiltered[source];
      data[target + 3] = unfiltered[source + 1];
    }
  }
  return { width, height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}
