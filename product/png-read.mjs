import { inflateSync } from 'node:zlib';
import { InputError } from '../server/input.mjs';

// Minimal dependency-free PNG reader used by 徽记恢复.
// It decodes every still PNG encoding the workbench accepts and exposes the
// raw color-space chunks so declaration policy can be enforced explicitly.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function readChunks(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new InputError('不是 PNG 文件：缺少 PNG 签名', 422);
  }
  const chunks = [];
  let offset = 8;
  let sawIend = false;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new InputError('PNG 数据块已损坏（长度越界）', 422);
    const data = buffer.subarray(dataStart, dataEnd);
    chunks.push({ type, data });
    offset = dataEnd + 4; // skip CRC; readers tolerate CRC quirks in old artwork
    if (type === 'IEND') { sawIend = true; break; }
  }
  if (!sawIend) throw new InputError('PNG 文件不完整：缺少 IEND 结束块', 422);
  return chunks;
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

function unpackChannels(colorType) {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 3) return 1;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new InputError(`不支持的 PNG 颜色类型 ${colorType}`, 422);
}

// Reconstruct filtered scanlines into raw packed bytes.
function reconstruct(data, width, height, bitDepth, channels, interlace) {
  const passes = interlace ? [
    { x: 0, y: 0, dx: 8, dy: 8 },
    { x: 4, y: 0, dx: 8, dy: 8 },
    { x: 0, y: 4, dx: 4, dy: 8 },
    { x: 2, y: 0, dx: 4, dy: 4 },
    { x: 0, y: 2, dx: 2, dy: 4 },
    { x: 1, y: 0, dx: 2, dy: 2 },
    { x: 0, y: 1, dx: 1, dy: 2 },
  ] : [{ x: 0, y: 0, dx: 1, dy: 1 }];

  // Output is organised per sample: one byte per sample below 16-bit depths
  // (sub-byte samples are unpacked), two bytes per sample at 16 bits.
  const sampleBytes = bitDepth === 16 ? 2 : 1;
  const output = Buffer.alloc(width * height * channels * sampleBytes);
  let cursor = 0;
  for (const pass of passes) {
    const pw = Math.ceil((width - pass.x) / pass.dx);
    const ph = Math.ceil((height - pass.y) / pass.dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil(pw * channels * bitDepth / 8);
    const bpp = bitDepth < 8 ? 1 : channels * (bitDepth / 8);
    const rows = [];
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < ph; y++) {
      if (cursor >= data.length) throw new InputError('PNG 图像数据不完整', 422);
      const filter = data[cursor++];
      if (cursor + stride > data.length) throw new InputError('PNG 扫描线已截断', 422);
      const row = Buffer.from(data.subarray(cursor, cursor + stride));
      cursor += stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        if (filter === 1) row[i] = (row[i] + a) & 255;
        else if (filter === 2) row[i] = (row[i] + b) & 255;
        else if (filter === 3) row[i] = (row[i] + ((a + b) >> 1)) & 255;
        else if (filter === 4) row[i] = (row[i] + paeth(a, b, c)) & 255;
        else if (filter !== 0) throw new InputError(`未知的 PNG 行过滤器 ${filter}`, 422);
      }
      rows.push({ row, py: pass.y + y * pass.dy });
      prev = row;
    }
    for (const { row, py } of rows) {
      for (let px = 0; px < pw; px++) {
        const x = pass.x + px * pass.dx;
        const p = py * width + x;
        if (bitDepth < 8) {
          const bits = bitDepth;
          const byte = row[px * bits >> 3];
          const shift = 8 - bits - ((px * bits) & 7);
          output[p] = (byte >> shift) & ((1 << bits) - 1); // unpacked sample index/value
        } else if (bitDepth === 8) {
          for (let c = 0; c < channels; c++) output[p * channels + c] = row[px * channels + c];
        } else {
          for (let c = 0; c < channels; c++) {
            output[p * channels * 2 + c * 2] = row[px * channels * 2 + c * 2];
            output[p * channels * 2 + c * 2 + 1] = row[px * channels * 2 + c * 2 + 1];
          }
        }
      }
    }
  }
  return output;
}

function readText(chunk) {
  // iCCP: profile name (latin1, NUL) + compression method byte + compressed profile
  const zero = chunk.data.indexOf(0);
  const name = chunk.data.subarray(0, zero).toString('latin1');
  const method = chunk.data[zero + 1];
  let profile = null;
  if (method === 0) {
    try { profile = inflateSync(chunk.data.subarray(zero + 2)); } catch { profile = null; }
  }
  return { name, profile };
}

function iccLooksSrgb(profile, name) {
  const haystack = `${name ?? ''} ${profile ? profile.toString('latin1') : ''}`.toLowerCase();
  if (/(display\s*p3|adobe\s*rgb|prophoto|linear|rec\.?\s*2020|bt\.?\s*2020|dcip3|dci-p3|romm|colormatch|widegamut|non[-\s]?srgb)/.test(haystack)) return false;
  if (haystack.includes('srgb') || haystack.includes('s rgb') || haystack.includes('iec61966-2-1') || haystack.includes('iec 61966-2-1')) return true;
  // The canonical sRGB v2 ICC profile carries the 'prtr'/'gTRC' signatures and
  // an sRGB media white; without a description we cannot prove sRGB, so callers
  // treat an unrecognisable profile as an explicit other declaration.
  return false;
}

// Evaluate all color-space declarations. Returns one of:
//   { state:'none' }                       old artwork, read as sRGB
//   { state:'srgb', claims:[...] }         consistently declared sRGB
//   { state:'reject', reasons:[...] }      explicit non-sRGB or conflicting
export function evaluateColorSpace(chunks) {
  const byType = type => chunks.filter(chunk => chunk.type === type);
  const srgb = byType('sRGB'), iccp = byType('iCCP'), gama = byType('gAMA'),
    chrm = byType('cHRM'), cicp = byType('cICP');
  const reasons = [];
  const claims = [];

  if (srgb.length > 1) reasons.push('包含多个 sRGB 块，颜色空间声明互相冲突');
  if (iccp.length > 1) reasons.push('包含多个 ICC 配置块（iCCP），颜色空间声明互相冲突');
  if (gama.length > 1) reasons.push('包含多个 gamma 块（gAMA），颜色空间声明互相冲突');
  if (chrm.length > 1) reasons.push('包含多个色度块（cHRM），颜色空间声明互相冲突');
  if (cicp.length > 1) reasons.push('包含多个 cICP 块，颜色空间声明互相冲突');

  let iccSrgb = null;
  for (const chunk of iccp) {
    const info = readText(chunk);
    if (!info.profile) {
      reasons.push('内嵌 ICC 配置（iCCP）无法识别或解压，不能按 sRGB 读取');
      iccSrgb = false;
      continue;
    }
    iccSrgb = iccLooksSrgb(info.profile, info.name);
    claims.push(iccSrgb ? 'icc:srgb' : `icc:other(${info.name || '未命名'})`);
    if (!iccSrgb) reasons.push(`内嵌 ICC 配置「${info.name || '未命名'}」明确不是 sRGB`);
  }

  let cicpSrgb = null;
  for (const chunk of cicp) {
    const d = chunk.data;
    if (d.length < 4) { reasons.push('cICP 颜色声明不完整'); continue; }
    const [primaries, transfer, matrix] = d;
    const isSrgb = primaries === 1 && transfer === 13 && matrix === 0;
    cicpSrgb = isSrgb;
    claims.push(isSrgb ? 'cicp:srgb' : `cicp:${primaries}/${transfer}/${matrix}`);
    if (!isSrgb) reasons.push(`cICP 声明了非 sRGB 颜色空间（原色 ${primaries}、传递 ${transfer}、矩阵 ${matrix}）`);
  }

  const SRGB_GAMMA = 45455;
  let gamma = null;
  for (const chunk of gama) {
    if (chunk.data.length < 4) { reasons.push('gAMA 声明不完整'); continue; }
    gamma = chunk.data.readUInt32BE(0);
    claims.push(`gAMA:${gamma}`);
    if (Math.abs(gamma - SRGB_GAMMA) > 64) reasons.push(`gAMA 声明的 gamma 值 ${gamma} 与 sRGB（45455）冲突，属于非 sRGB 颜色空间`);
  }

  // sRGB cHRM reference values in PNG fixed point (x100000).
  const SRGB_CHRM = [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000];
  let chrmNonSrgb = false;
  for (const chunk of chrm) {
    if (chunk.data.length < 32) { reasons.push('cHRM 声明不完整'); continue; }
    const values = Array.from({ length: 8 }, (_, i) => chunk.data.readUInt32BE(i * 4));
    claims.push(`cHRM:${values.join('/')}`);
    chrmNonSrgb = values.some((v, i) => Math.abs(v - SRGB_CHRM[i]) > 60);
    if (chrmNonSrgb) reasons.push('cHRM 声明的三原色色度与 sRGB 不一致，属于明确的非 sRGB 颜色空间');
  }

  const hasSrgbChunk = srgb.length > 0;
  if (hasSrgbChunk) {
    for (const chunk of srgb) {
      if (chunk.data.length !== 1 || chunk.data[0] > 3) reasons.push('sRGB 块的渲染意图不合法，颜色空间声明无效或互相冲突');
    }
    claims.unshift('sRGB');
  }

  // Cross-declaration conflicts.
  if (hasSrgbChunk && iccp.length) {
    if (iccSrgb === false) reasons.push('sRGB 块与非 sRGB 的 ICC 配置同时存在，颜色空间声明互相冲突');
  }
  if (hasSrgbChunk && cicp.length && cicpSrgb === false) {
    reasons.push('sRGB 块与非 sRGB 的 cICP 声明互相冲突');
  }
  if (hasSrgbChunk && gamma !== null && Math.abs(gamma - SRGB_GAMMA) > 64) {
    reasons.push('sRGB 块与 gAMA gamma 声明互相冲突');
  }
  if (hasSrgbChunk && chrmNonSrgb) reasons.push('sRGB 块与 cHRM 色度声明互相冲突');
  if (iccSrgb === false && cicpSrgb === true) reasons.push('ICC 配置与 cICP 的颜色空间声明互相冲突');
  if (iccSrgb === true && cicpSrgb === false) reasons.push('ICC 配置与 cICP 的颜色空间声明互相冲突');

  if (reasons.length) return { state: 'reject', reasons, claims };
  const declared = hasSrgbChunk || iccSrgb === true || cicpSrgb === true ||
    (gamma !== null && Math.abs(gamma - SRGB_GAMMA) <= 64) ||
    (chrm.length > 0 && !chrmNonSrgb);
  return { state: declared ? 'srgb' : 'none', claims, reasons: [] };
}

// Decode a PNG into straight-alpha 16-bit RGBA samples plus metadata.
// 8-bit sources are scaled by 257 so exact 8-bit representability is a modulo
// test even for 16-bit PNGs.
export function decodePng(buffer) {
  const chunks = readChunks(buffer);
  const ihdr = chunks.find(chunk => chunk.type === 'IHDR');
  if (!ihdr || ihdr.data.length < 13) throw new InputError('PNG 缺少 IHDR 图像头', 422);
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const compression = ihdr.data[10];
  const filterMethod = ihdr.data[11];
  const interlace = ihdr.data[12];
  if (compression !== 0 || filterMethod !== 0) throw new InputError('PNG 使用了不支持的压缩方式', 422);
  if (![0, 2, 3, 4, 6].includes(colorType)) throw new InputError(`不支持的 PNG 颜色类型 ${colorType}`, 422);
  const allowedDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[colorType];
  if (!allowedDepths.includes(bitDepth)) throw new InputError(`PNG 位深 ${bitDepth} 与颜色类型 ${colorType} 不受支持`, 422);
  if (interlace > 1) throw new InputError('PNG 隔行扫描方式不受支持', 422);
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
    width < 16 || width > 64 || height < 16 || height > 64) {
    throw new InputError(`只接收宽、高各为 16–64 像素的 PNG；这张是 ${width} × ${height}`, 422);
  }
  if (chunks.some(chunk => chunk.type === 'acTL')) {
    throw new InputError('这是动态 APNG，不是静态 PNG；请先导出当前帧的静态 PNG', 422);
  }

  const idat = Buffer.concat(chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data));
  if (!idat.length) throw new InputError('PNG 缺少 IDAT 图像数据', 422);
  let inflated;
  try { inflated = inflateSync(idat); } catch { throw new InputError('PNG 的 IDAT 数据无法解压', 422); }

  const channels = unpackChannels(colorType);
  const packed = reconstruct(inflated, width, height, bitDepth, channels, interlace);
  const count = width * height;
  const rgba16 = new Uint16Array(count * 4);

  const plte = chunks.find(chunk => chunk.type === 'PLTE');
  let palette = null;
  if (colorType === 3) {
    if (!plte || plte.data.length % 3 !== 0) throw new InputError('索引色 PNG 缺少有效的 PLTE 调色板', 422);
    palette = [];
    for (let i = 0; i < plte.data.length; i += 3) palette.push([plte.data[i], plte.data[i + 1], plte.data[i + 2]]);
  }
  const trns = chunks.find(chunk => chunk.type === 'tRNS');

  const scale8 = v => v * 257;
  const grayTo16 = sample => bitDepth === 16 ? sample : scale8(Math.round(sample * 255 / ((1 << bitDepth) - 1)));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      let r = 0, g = 0, b = 0, a = 65535;
      if (colorType === 3) {
        const index = packed[p];
        const entry = palette[index];
        if (!entry) throw new InputError('PNG 像素引用了调色板之外的颜色', 422);
        [r, g, b] = entry.map(scale8);
        a = trns && index < trns.data.length ? scale8(trns.data[index]) : 65535;
      } else if (bitDepth === 16) {
        const get16 = c => packed[p * channels * 2 + c * 2] * 256 + packed[p * channels * 2 + c * 2 + 1];
        if (colorType === 0) { r = g = b = grayTo16(get16(0)); a = 65535; }
        if (colorType === 2) { r = get16(0); g = get16(1); b = get16(2); }
        if (colorType === 4) { r = g = b = get16(0); a = get16(1); }
        if (colorType === 6) { r = get16(0); g = get16(1); b = get16(2); a = get16(3); }
        if (trns) {
          if (colorType === 0 && trns.data.length >= 2) {
            const key = trns.data.readUInt16BE(0); if (get16(0) === key) a = 0;
          } else if (colorType === 2 && trns.data.length >= 6) {
            if (r === trns.data.readUInt16BE(0) && g === trns.data.readUInt16BE(2) && b === trns.data.readUInt16BE(4)) a = 0;
          }
        }
      } else {
        const byteIndex = p * channels;
        if (colorType === 0) { const v = grayTo16(packed[p]); r = g = b = v; }
        if (colorType === 2) { r = scale8(packed[byteIndex]); g = scale8(packed[byteIndex + 1]); b = scale8(packed[byteIndex + 2]); }
        if (colorType === 4) { const v = grayTo16(packed[p * 2]); r = g = b = v; a = scale8(packed[p * 2 + 1]); }
        if (colorType === 6) { r = scale8(packed[byteIndex]); g = scale8(packed[byteIndex + 1]); b = scale8(packed[byteIndex + 2]); a = scale8(packed[byteIndex + 3]); }
        if (trns) {
          if (colorType === 0 && trns.data.length >= 2) {
            const key = trns.data[1]; const bits = bitDepth;
            const raw = packed[p];
            const keySample = bits === 8 ? key : Math.round(key * ((1 << bits) - 1) / 255);
            if (raw === keySample) a = 0;
          } else if (colorType === 2 && trns.data.length >= 6) {
            if (r === scale8(trns.data[1]) && g === scale8(trns.data[3]) && b === scale8(trns.data[5])) a = 0;
          }
        }
      }
      rgba16[p * 4] = r; rgba16[p * 4 + 1] = g; rgba16[p * 4 + 2] = b; rgba16[p * 4 + 3] = a;
    }
  }

  return { width, height, bitDepth, colorType, interlaced: interlace === 1, chunks, rgba16, colorSpace: evaluateColorSpace(chunks) };
}

// Convenience: decode and enforce the workbench color-space admission policy.
export function readPng(buffer) {
  const decoded = decodePng(buffer);
  if (decoded.colorSpace.state === 'reject') {
    throw new InputError(decoded.colorSpace.reasons.join('；'), 422);
  }
  return decoded;
}
