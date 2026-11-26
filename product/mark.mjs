// Reusable emblem material ("mark") exported from a frozen proof.
//
// The material never carries vector sources, shapes or transforms. It only
// stores three raster plates rendered by the same engine that produced the
// frozen proof:
//   - plate 0: the emblem over a fully transparent backdrop (premultiplied
//     RGB plus its own coverage in alpha),
//   - plate 1: premultiplied RGB over an opaque black backdrop,
//   - plate 2: premultiplied RGB over an opaque white backdrop.
//
// For this engine the composited color of any pixel is affine in the
// backdrop color for a fixed backdrop coverage and affine in that coverage.
// With d0 the transparent-backdrop result, dB the black result and dW the
// white result, the result over a straight-RGBA backdrop (b, a) is
//
//   premultipliedChannel = a * (dB + (dW-dB) * b) + (1-a) * d0
//   coverage             = a + (1-a) * plate0.alpha
//
// so the same material composites over any backdrop without recomputing
// geometry, masks or blend math. Plates are kept at 16 bits so the 8-bit
// output stays within one quantization unit of a direct proof.

export const MARK_MAGIC = 0x4d41524b; // "MARK"
export const MARK_FORMAT_VERSION = 1;
export const MARK_TYPE = 'application/x-ink-mark';
export const MARK_SUFFIX = 'inkmark';
const PLATE_COUNT = 3;
const PLATE_CHANNELS = 4;

// Header: magic, format version, width, height, then one body offset per plate.
const headerLength = () => 16 + PLATE_COUNT * 4;

function checkDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('徽记素材尺寸无效');
  }
}

// `plates` is an array of three Uint16Array(width*height*4), values 0..65535.
export function encodeMark(width, height, plates, deflate) {
  checkDimensions(width, height);
  if (!Array.isArray(plates) || plates.length !== PLATE_COUNT) throw new Error('徽记素材需要三块底板');
  const bodySize = width * height * PLATE_CHANNELS * 2;
  const bodies = plates.map((plate, index) => {
    if (!(plate instanceof Uint16Array) || plate.length !== width * height * PLATE_CHANNELS) {
      throw new Error(`徽记底板 ${index} 尺寸不匹配`);
    }
    // Network/PDF-style 16-bit order keeps the file unambiguous.
    const bytes = Buffer.alloc(bodySize);
    for (let i = 0; i < plate.length; i++) bytes.writeUInt16BE(plate[i], i * 2);
    return deflate(bytes);
  });
  const header = Buffer.alloc(headerLength());
  header.writeUInt32BE(MARK_MAGIC, 0);
  header.writeUInt32BE(MARK_FORMAT_VERSION, 4);
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  let cursor = header.length;
  bodies.forEach((body, index) => {
    header.writeUInt32BE(cursor, 16 + index * 4);
    cursor += body.length;
  });
  return Buffer.concat([header, ...bodies]);
}

// Parses the container and inflates every plate. `inflate(bytes) -> Promise<Uint8Array>`
// is supplied by the platform (zlib in Node, DecompressionStream in browsers).
export async function decodeMark(bytes, inflate) {
  if (bytes.byteLength < headerLength()) throw new Error('徽记素材已损坏');
  const view = bytes instanceof ArrayBuffer ? new DataView(bytes)
    : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== MARK_MAGIC) throw new Error('不是徽记素材文件');
  if (view.getUint32(4) !== MARK_FORMAT_VERSION) throw new Error('徽记素材版本不受支持');
  const width = view.getUint32(8);
  const height = view.getUint32(12);
  checkDimensions(width, height);
  const count = width * height * PLATE_CHANNELS;
  const plates = [];
  for (let plate = 0; plate < PLATE_COUNT; plate++) {
    const offset = view.getUint32(16 + plate * 4);
    const end = plate + 1 < PLATE_COUNT ? view.getUint32(16 + (plate + 1) * 4) : bytes.byteLength;
    if (offset < headerLength() || end <= offset || end > bytes.byteLength) throw new Error('徽记素材底板越界');
    const inflated = await inflate(bytes.slice(offset, end));
    if (inflated.byteLength !== count * 2) throw new Error('徽记素材底板尺寸不匹配');
    const data = new Uint16Array(count);
    const source = inflated instanceof ArrayBuffer ? new DataView(inflated)
      : new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
    for (let i = 0; i < count; i++) data[i] = source.getUint16(i * 2, false);
    plates.push(data);
  }
  return { width, height, plates };
}

// Local composite over an 8-bit straight-RGBA backdrop of identical size.
// Returns straight 8-bit RGBA pixels; pixels with zero output alpha always
// encode zero RGB, even when the backdrop itself carried color.
export function compositeMark(mark, backdrop) {
  const { width, height, plates } = mark;
  if (backdrop.width !== width || backdrop.height !== height) {
    throw new Error(`底图尺寸 ${backdrop.width}×${backdrop.height} 与徽记画布 ${width}×${height} 不一致，已停止出图`);
  }
  const [clear, black, white] = plates;
  const out = new Uint8Array(width * height * 4);
  const scale = 65535;
  for (let p = 0, pixel = 0; pixel < width * height; pixel++, p += 4) {
    const a = backdrop.pixels[p + 3] / 255;
    const coverage = a + (1 - a) * (clear[p + 3] / scale);
    const alpha = Math.round(255 * Math.min(1, Math.max(0, coverage)));
    if (alpha === 0) continue;
    out[p + 3] = alpha;
    const keep = 1 - a;
    for (let channel = 0; channel < 3; channel++) {
      const index = p + channel;
      const b = backdrop.pixels[index] / 255;
      const d0 = clear[index] / scale;
      const dB = black[index] / scale;
      const dW = white[index] / scale;
      // Opaque-backdrop response is affine in the backdrop straight color b;
      // blend between that response and the transparent-backdrop result by
      // backdrop coverage. All plate values are premultiplied.
      const premultiplied = keep * d0 + a * (dB + (dW - dB) * b);
      const unPremultiplied = premultiplied / coverage;
      const straight = Math.min(1, Math.max(0, unPremultiplied));
      out[index] = Math.round(255 * straight);
    }
  }
  return out;
}
