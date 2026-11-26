import { inverse } from './transform.mjs';
import { channels, parseColor } from './color.mjs';
import { sampleCoverage } from './masks.mjs';
import { grayPng, readPlatePng } from './png.mjs';
import { InputError, requireThat } from '../server/input.mjs';

export const PLATE_IDS = ['a', 'b'];
export const INK_COUNT = 2;

// Scale an ink amount in [0,1] to a byte. Nearest integer; an exact half
// rounds toward the larger value (half-up for non-negative quantities).
export function inkByte(amount) {
  if (!(amount > 0)) return 0;
  if (amount >= 1) return 255;
  return Math.floor(255 * amount + 0.5 + 1e-9);
}

export const roundInk = inkByte;
export const roundHalfUp255 = inkByte;

// Parse the many ways a document may name one of the two inks. Returns
// 0 / 1 for a plate, or -1 when the layer deposits no ink. Numeric 1 vs 2
// is resolved one-based (printer facing); document-level callers that detect
// a zero-based 0/1 convention pass `numericBase: 0`.
export function normalizePlateRef(value, numericBase = 1) {
  if (value == null || value === false || value === '') return -1;
  if (typeof value === 'object') {
    const inner = value.plate ?? value.ink ?? value.id ?? value.index ?? value.station;
    return normalizePlateRef(inner, numericBase);
  }
  if (typeof value === 'number' || /^-?\d+$/.test(String(value).trim())) {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new InputError('墨版编号须为整数', 422);
    if (n === -1) return -1;
    if (n === 0) return 0;
    if (numericBase === 0) {
      if (n === 1) return 1;
      throw new InputError('只有两支墨（编号 0/1 或 a/b）', 422);
    }
    if (n === 1) return 0;
    if (n === 2) return 1;
    throw new InputError('只有两支墨（编号 1/2 或 a/b）', 422);
  }
  const token = String(value).trim().toLowerCase();
  if (/^(a|plate[-_ ]?a|ink[-_ ]?a|spot[-_ ]?a|p1|ink1|first|one|1|墨?一|第一支?|青版)$/.test(token)) return 0;
  if (/^(b|plate[-_ ]?b|ink[-_ ]?b|spot[-_ ]?b|p2|ink2|second|two|2|墨?二|第二支?|品红版)$/.test(token)) return 1;
  throw new InputError(`无法识别的墨版归属：${String(value)}（应为 a / b 或不指定）`, 422);
}

// Overprint = true leaves the other ink untouched; false (knockout) scales it
// by (1 - effective opacity). Accepts booleans and English/Chinese mode names.
export function normalizeOverprint(layer = {}) {
  if (typeof layer.overprint === 'boolean') return layer.overprint;
  if (typeof layer.overprint === 'string') return parseMode(layer.overprint) === 'overprint';
  if (typeof layer.knockout === 'boolean' || typeof layer.knockOut === 'boolean') {
    return !(layer.knockout ?? layer.knockOut);
  }
  if (typeof layer.knockout === 'string' || typeof layer.knockOut === 'string') {
    return parseMode(layer.knockout ?? layer.knockOut) === 'overprint';
  }
  const mode = layer.plateMode ?? layer.inkMode ?? layer.trap ?? layer.treatment ?? layer.mode;
  if (mode != null) return parseMode(mode) === 'overprint';
  return false;
}

function parseMode(value) {
  if (value === true) return 'overprint';
  if (value === false) return 'knockout';
  const token = String(value).trim().toLowerCase().replace(/[\s_-]/g, '');
  if (['overprint', 'over', '叠印', '套印', '叠', 'multiplyink'].includes(token)) return 'overprint';
  if (['knockout', 'cutout', 'hole', 'knock', '挖空', '镂空', '套空'].includes(token)) return 'knockout';
  throw new InputError(`墨版交互方式须为 overprint（叠印）或 knockout（挖空），收到：${value}`, 422);
}

// Find an ink-assignment value under every plausible field name, including
// nested `print` / `spot` / `inkConfig` objects.
export function readPlateAssignment(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { value: undefined, key: null };
  const directKeys = ['plate', 'inkPlate', 'colorPlate', 'plateId', 'inkId', 'spot', 'spotColor', 'ink', 'station', 'unit'];
  for (const key of directKeys) {
    if (row[key] !== undefined) return { value: row[key], key };
  }
  for (const key of ['print', 'spotConfig', 'plateConfig', 'inkConfig']) {
    const nested = row[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const found = readPlateAssignment(nested);
      if (found.value !== undefined) return found;
    }
  }
  return { value: undefined, key: null };
}

// Detect a zero-based numeric 0/1 convention across the whole layer stack.
// `inferred` is false when the document never uses a 0 or a 2, in which case a
// lone numeric index stays ambiguous and the field name is used as a hint.
export function assignmentConvention(inputLayers = []) {
  let sawZero = false, sawTwo = false, numericCount = 0;
  for (const row of inputLayers) {
    const { value } = readPlateAssignment(row);
    if (typeof value === 'number' && Number.isInteger(value)) {
      numericCount++;
      if (value === 0) sawZero = true;
      if (value === 2) sawTwo = true;
    }
  }
  if (sawTwo) return { base: 1, inferred: true };
  if (sawZero && numericCount > 0) return { base: 0, inferred: true };
  return { base: 1, inferred: false };
}

export function numericInkBase(inputLayers = []) {
  return assignmentConvention(inputLayers).base;
}

// Resolve one raw layer's ink assignment, applying the document convention and
// the `ink` key's zero-based hint for an otherwise ambiguous lone index.
export function resolvePlateIndex(row, convention = { base: 1, inferred: false }) {
  const { value, key } = readPlateAssignment(row);
  if (value === undefined || value === null || value === false || value === '') return -1;
  let base = convention.base ?? 1;
  if (!convention.inferred && typeof value === 'number' && (key === 'ink' || key === 'inkId')) base = 0;
  return normalizePlateRef(value, base);
}

// The heart of the feature. Geometry, masks, visibility and sub-sample grid
// mirror raster.mjs exactly; only the color state is replaced by two ink
// amounts following the distance-to-full rule described in the spec.
export function rasterPlates(document) {
  const { width, height, samples } = document;
  const normalized = document.__normalized === true;
  const convention = assignmentConvention(document.layers);
  const layers = document.layers.map((layer) => {
    let plate;
    if (normalized && Number.isInteger(layer.plate) && layer.plate >= -1 && layer.plate <= 1) {
      plate = layer.plate;
    } else {
      plate = resolvePlateIndex(layer, convention);
    }
    const overprint = typeof layer.overprint === 'boolean'
      ? layer.overprint
      : normalizeOverprint(layer);
    return {
      ...layer,
      plate,
      overprint,
      rgba: channels(layer.color),
      toLocal: inverse(layer.transform),
      maskIndex: document.layers.findIndex((row) => row.id === layer.mask),
      inkHits: 0,
    };
  });
  const covered = new Uint8Array(layers.length);
  const perSample = [0, 0];
  const sum = [0, 0];
  const gray = [Buffer.alloc(width * height), Buffer.alloc(width * height)];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      sum[0] = 0; sum[1] = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          sampleCoverage(layers, x + (sx + 0.5) / samples, y + (sy + 0.5) / samples, covered);
          perSample[0] = 0; perSample[1] = 0;
          for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            if (!covered[i] || !layer.visible) continue;
            const alpha = layer.opacity * layer.rgba[3];
            if (!(alpha > 0) || layer.plate < 0 || layer.plate > 1) continue;
            layer.inkHits++;
            const own = layer.plate;
            const other = 1 - own;
            // Own ink: remaining gap to full is scaled by (1 - alpha).
            perSample[own] = 1 - (1 - perSample[own]) * (1 - alpha);
            // Overprint leaves the other ink alone; knockout scales it.
            if (!layer.overprint) perSample[other] *= (1 - alpha);
          }
          sum[0] += perSample[0];
          sum[1] += perSample[1];
        }
      }
      const index = y * width + x;
      const count = samples * samples;
      gray[0][index] = inkByte(sum[0] / count);
      gray[1][index] = inkByte(sum[1] / count);
    }
  }
  return {
    width, height, samples,
    gray,
    plates: gray,
    layerStats: layers.map(({ id, plate, overprint, visible, inkHits }) => ({ id, plate, overprint, visible, hits: inkHits })),
  };
}

export const makePlates = rasterPlates;
export const generatePlates = rasterPlates;

// Rasterize and encode both delivered plate files.
export function renderPlates(document) {
  const result = rasterPlates(document);
  const files = PLATE_IDS.map((id, index) => {
    const bytes = grayPng(result.width, result.height, result.gray[index]);
    return {
      id,
      plate: id,
      ink: index,
      index,
      width: result.width,
      height: result.height,
      mediaType: 'image/png',
      type: 'image/png',
      suffix: `plate-${id}.png`,
      filename: `plate-${id}.png`,
      bytes,
      base64: bytes.toString('base64'),
      gray: result.gray[index],
    };
  });
  return { ...result, files, bytes: files.map((file) => file.bytes),
    a: files[0].bytes, b: files[1].bytes,
    pngA: files[0].bytes, pngB: files[1].bytes,
    bufferA: files[0].bytes, bufferB: files[1].bytes };
}

export const buildPlates = renderPlates;
export const plateFiles = renderPlates;

// ---- White-paper overprint proof from the two hand-held plate files ----

export function normalizeInkColor(value, fallback = '#ffffff') {
  if (value == null) value = fallback;
  if (Array.isArray(value)) {
    requireThat(value.length >= 3 && value.slice(0, 3).every((n) => Number.isInteger(n) && n >= 0 && n <= 255),
      '满印模拟色须为三个 0–255 整数', 422);
    return value.slice(0, 3).map((n) => n / 255);
  }
  if (typeof value === 'object') {
    const r = value.r ?? value[0], g = value.g ?? value[1], b = value.b ?? value[2];
    return normalizeInkColor([r, g, b], fallback);
  }
  const hex = parseColor(String(value));
  const [r, g, b] = channels(hex);
  return [r, g, b];
}

export function normalizeShift(value) {
  if (value == null) return { dx: 0, dy: 0 };
  if (typeof value === 'number') return { dx: Math.trunc(value), dy: 0 };
  if (Array.isArray(value)) return { dx: Math.trunc(value[0] ?? 0), dy: Math.trunc(value[1] ?? 0) };
  if (typeof value === 'object') {
    const dx = value.dx ?? value.x ?? value.shiftX ?? value.offsetX ?? value.horizontal ?? 0;
    const dy = value.dy ?? value.y ?? value.shiftY ?? value.offsetY ?? value.vertical ?? 0;
    requireThat(Number.isFinite(dx) && Number.isFinite(dy), '挪位须为整数像素', 422);
    return { dx: Math.trunc(dx), dy: Math.trunc(dy) };
  }
  throw new InputError('挪位格式无法识别', 422);
}

function shiftFor(body, which) {
  const upper = which.toUpperCase();
  const candidates = [
    body[`shift${upper}`], body[`offset${upper}`], body[`move${upper}`],
    body[`${which}Shift`], body[`${which}Offset`], body[`shift${which}`],
  ];
  // Nested maps: { shift: { a: {dx,dy}, b: {...} } } and friends.
  for (const mapName of ['shift', 'shifts', 'offset', 'offsets']) {
    const map = body[mapName];
    if (map && typeof map === 'object') {
      candidates.push(map[which], map[upper], map[which.toUpperCase()]);
    }
  }
  for (const candidate of candidates) if (candidate !== undefined && candidate !== null) return normalizeShift(candidate);
  // A single shared shift directed at one named plate.
  const target = body.plate ?? body.which ?? body.target ?? body.shiftPlate ?? body.moving;
  if (target != null && normalizePlateRef(target) === (which === 'a' ? 0 : 1)) {
    if (body.shift !== undefined && !(typeof body.shift === 'object' && !Array.isArray(body.shift) && ('a' in body.shift || 'b' in body.shift))) return normalizeShift(body.shift);
    if (body.offset !== undefined && !(typeof body.offset === 'object' && ('a' in body.offset || 'b' in body.offset))) return normalizeShift(body.offset);
    if (body.dx !== undefined || body.dy !== undefined || body.x !== undefined || body.y !== undefined) {
      return normalizeShift({ dx: body.dx ?? body.x, dy: body.dy ?? body.y });
    }
  }
  return { dx: 0, dy: 0 };
}

// Resolve one full-print simulation color from the many request shapes.
function colorFor(body, which) {
  const index = which === 'a' ? 0 : 1;
  const upper = which.toUpperCase();
  const direct = [
    body[`color${upper}`], body[`inkColor${upper}`], body[`full${upper}`],
    body[`${which}Color`], body[`${which}Ink`], body[`ink${upper}Color`],
  ];
  for (const value of direct) if (value != null) return value;
  for (const groupName of ['inks', 'inkColors', 'colors', 'simulation', 'simulationColors', 'ink']) {
    const group = body[groupName];
    if (group == null) continue;
    if (Array.isArray(group)) {
      if (group[index] != null) {
        const item = group[index];
        return typeof item === 'object' ? (item.color ?? item.rgb ?? item.hex) : item;
      }
    } else if (typeof group === 'object') {
      const value = group[which] ?? group[upper] ?? group[index];
      if (value != null) return typeof value === 'object' ? (value.color ?? value.rgb ?? value.hex ?? value) : value;
    }
  }
  return undefined;
}

// Pure pixel math. `plateA` / `plateB` are {width,height,gray} decoded files.
// Paper size follows the plates (which must share dimensions). Returns opaque
// straight RGBA bytes; all color interpolation happens on sRGB encoded values.
export function compositeProof(options = {}) {
  const plateA = options.plateA ?? options.a;
  const plateB = options.plateB ?? options.b;
  requireThat(plateA && plateB, '校样需要两张版文件', 422);
  if (plateA.width !== plateB.width || plateA.height !== plateB.height) {
    throw new InputError(`两版尺寸不一致（${plateA.width}×${plateA.height} 对 ${plateB.width}×${plateB.height}），无法出校样`, 422);
  }
  const width = options.width ?? plateA.width;
  const height = options.height ?? plateA.height;
  const shiftA = normalizeShift(options.shiftA ?? options.offsetA ?? { dx: 0, dy: 0 });
  const shiftB = normalizeShift(options.shiftB ?? options.offsetB ?? { dx: 0, dy: 0 });
  const colorA = normalizeInkColor(options.colorA ?? options.inkColorA ?? options.inks?.a ?? options.inkColors?.a ?? options.colors?.[0], '#009fe3');
  const colorB = normalizeInkColor(options.colorB ?? options.inkColorB ?? options.inks?.b ?? options.inkColors?.b ?? options.colors?.[1], '#e5007d');

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inkA = samplePlate(plateA, x - shiftA.dx, y - shiftA.dy);
      const inkB = samplePlate(plateB, x - shiftB.dx, y - shiftB.dy);
      const offset = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        // Single-ink ramp between paper white (1) and full-print color.
        const singleA = 1 + (colorA[c] - 1) * inkA;
        const singleB = 1 + (colorB[c] - 1) * inkB;
        // Two inks overlap: normalized channels multiply.
        rgba[offset + c] = inkByte(singleA * singleB);
      }
      rgba[offset + 3] = 255;
    }
  }
  return { width, height, pixels: rgba, rgba, shiftA, shiftB, colorA, colorB };
}

export const overprintProof = compositeProof;
export const proofPlates = compositeProof;
export const buildProof = compositeProof;

// Outside the plate rectangle there is no ink (gray 0).
function samplePlate(plate, sx, sy) {
  if (sx < 0 || sy < 0 || sx >= plate.width || sy >= plate.height) return 0;
  return plate.gray[sy * plate.width + sx] / 255;
}

// Decode two base64/buffer file descriptors from a JSON/multipart request and
// run the proof. `body` fields are deliberately accepted under many names.
export function proofFromBody(body = {}, files = {}) {
  const descriptor = (which) => {
    if (files[which]) return decodeDescriptor(files[which]);
    const candidates = [
      body[which], body[`plate${which.toUpperCase()}`], body[`file${which.toUpperCase()}`],
      body[`${which}File`], body[`${which}Png`], body[`png${which.toUpperCase()}`],
      body[`base64${which.toUpperCase()}`], body[`${which}Base64`], body[`image${which.toUpperCase()}`],
    ];
    if (which === 'a' && body.plates) candidates.push(Array.isArray(body.plates) ? body.plates[0] : body.plates.a);
    if (which === 'b' && body.plates) candidates.push(Array.isArray(body.plates) ? body.plates[1] : body.plates.b);
    for (const candidate of candidates) {
      if (candidate == null) continue;
      return decodeDescriptor(candidate);
    }
    throw new InputError(`缺少第 ${which === 'a' ? '一' : '二'} 张版文件`, 422);
  };
  const plateA = descriptor('a');
  const plateB = descriptor('b');
  const proof = compositeProof({
    plateA, plateB,
    shiftA: shiftFor(body, 'a'),
    shiftB: shiftFor(body, 'b'),
    colorA: colorFor(body, 'a'),
    colorB: colorFor(body, 'b'),
  });
  return proof;
}

export function decodeDescriptor(value) {
  if (Buffer.isBuffer(value)) return readPlatePng(value);
  if (value instanceof Uint8Array) return readPlatePng(Buffer.from(value));
  if (typeof value === 'object' && value !== null) {
    if (Buffer.isBuffer(value.buffer)) return readPlatePng(value.buffer);
    if (value.data) return decodeDescriptor(value.data);
    if (value.base64 != null) return decodeDescriptor(value.base64);
  }
  if (typeof value === 'string') {
    const base64 = value.startsWith('data:') ? value.slice(value.indexOf(',') + 1) : value;
    let buffer;
    try { buffer = Buffer.from(base64, 'base64'); }
    catch { throw new InputError('版文件 base64 无法解码', 422); }
    return readPlatePng(buffer);
  }
  throw new InputError('版文件内容无法识别', 422);
}
