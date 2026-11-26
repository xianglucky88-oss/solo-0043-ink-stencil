// Area-weighted periodic resampling. This module is environment-neutral and
// can be imported by both Node tests/tools and the browser workbench.

const CELL_MIN = 1;
const CELL_MAX = 32;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function coerceFinite(value) {
  if (finiteNumber(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = coerceFinite(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function positiveInteger(value, fallback, label) {
  const number = coerceFinite(value) ?? fallback;
  if (!Number.isInteger(number) || number <= 0) throw new RangeError(`${label} 必须是正整数`);
  return number;
}

export function resolveCellSize(options = {}) {
  const direct = firstFinite(
    options.cell,
    options.cellSize,
    options.footprint,
    options.footprintSize,
    options.pixelSide,
    options.designPixelsPerOutputPixel,
    options.designPixels,
    options.sourcePixelSize,
    options.downscale,
    options.downsample,
  );
  if (direct !== undefined) {
    if (direct < CELL_MIN || direct > CELL_MAX) throw new RangeError('每输出像素边长必须为 1–32 个设计像素');
    return direct;
  }

  const ratio = firstFinite(options.ratio, options.scale, options.zoom, options.factor, options.magnification);
  if (ratio === undefined) return 1;
  if (ratio > 0 && ratio < 1) {
    const cell = 1 / ratio;
    if (cell < CELL_MIN || cell > CELL_MAX) throw new RangeError('每输出像素边长必须为 1–32 个设计像素');
    return cell;
  }
  if (ratio >= CELL_MIN && ratio <= CELL_MAX) return ratio;
  throw new RangeError('缩小比例必须对应 1–32 个设计像素的边长');
}

function normalizeCall(args) {
  let image = {};
  let options = {};

  if (args[0] && typeof args[0] === 'object' && !ArrayBuffer.isView(args[0]) && (args[0].data || typeof args[0].getContext === 'function')) {
    image = args[0];
    if (args[1] && typeof args[1] === 'object') options = args[1];
    else {
      options = args[3] ?? {};
      if (args[1] !== undefined) options.outputWidth ??= args[1];
      if (args[2] !== undefined) options.outputHeight ??= args[2];
    }
  } else if (typeof args[0] === 'number') {
    image = { width: args[0], height: args[1], data: args[2] };
    options = args[3] ?? {};
  } else {
    image = { data: args[0] };
    if (args[1] && typeof args[1] === 'object') {
      image.width = args[1].width;
      image.height = args[1].height;
      options = args[1];
    } else {
      image.width = args[1];
      image.height = args[2];
      options = args[3] ?? {};
    }
  }

  // An ImageData-like first argument may also carry requested settings.
  return { image, options: { ...image, ...options } };
}

function modulo(value, period) {
  return ((value % period) + period) % period;
}

function offsetAxis(options, axis) {
  const upper = axis === 'x' ? 'X' : 'Y';
  const direct = firstFinite(
    options[`offset${upper}`],
    options[`origin${upper}`],
    options[`start${upper}`],
    options[axis],
    options[axis === 'x' ? 'left' : 'top'],
  );
  if (direct !== undefined) return direct;
  for (const key of ['offset', 'origin', 'start', 'topLeft', 'position']) {
    const value = options[key];
    if (Array.isArray(value) && finiteNumber(value[axis === 'x' ? 0 : 1])) {
      return value[axis === 'x' ? 0 : 1];
    }
    if (value && typeof value === 'object') {
      const candidate = firstFinite(value[axis], value[axis === 'x' ? 'x' : 'y'], value[axis === 'x' ? 'left' : 'top']);
      if (candidate !== undefined) return candidate;
    }
  }
  return 0;
}

function outputDimension(options, axis) {
  const upper = axis === 'x' ? 'Width' : 'Height';
  const direct = firstFinite(
    options[`output${upper}`],
    options[`out${upper}`],
    options[`target${upper}`],
    options[axis === 'x' ? 'dw' : 'dh'],
    options[axis === 'x' ? 'w' : 'h'],
    options[axis === 'x' ? 'width' : 'height'],
  );
  if (direct !== undefined) return direct;
  for (const key of ['output', 'size', 'dimensions']) {
    const value = options[key];
    if (value && typeof value === 'object') {
      const candidate = firstFinite(
        value[axis === 'x' ? 'width' : 'height'],
        value[axis],
        Array.isArray(value) ? value[axis === 'x' ? 0 : 1] : undefined,
      );
      if (candidate !== undefined) return candidate;
    }
  }
  return undefined;
}

function overlapInterval(start, end, pixel) {
  return Math.max(0, Math.min(end, pixel + 1) - Math.max(start, pixel));
}

export function resampleTile(...args) {
  let { image, options } = normalizeCall(args);
  if (!image.data && typeof image.getContext === 'function') {
    const context = image.getContext('2d', { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, image.width, image.height);
    image = imageData;
  }
  const sourceWidth = positiveInteger(image.width, undefined, '图案宽度');
  const sourceHeight = positiveInteger(image.height, undefined, '图案高度');
  const source = image.data;
  if (!source || source.length < sourceWidth * sourceHeight * 4) {
    throw new RangeError('图案需要完整的 RGBA 像素数据');
  }

  const outputWidth = positiveInteger(outputDimension(options, 'x') ?? sourceWidth, undefined, '输出宽度');
  const outputHeight = positiveInteger(outputDimension(options, 'y') ?? sourceHeight, undefined, '输出高度');
  const cell = resolveCellSize(options);
  const offsetX = offsetAxis(options, 'x');
  const offsetY = offsetAxis(options, 'y');
  if (!finiteNumber(offsetX) || !finiteNumber(offsetY)) throw new RangeError('起点必须是有限数值');

  const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  const footprintArea = cell * cell;

  for (let oy = 0; oy < outputHeight; oy++) {
    const top = offsetY + oy * cell;
    const bottom = top + cell;
    const rowFirst = Math.floor(top);
    const rowLast = Math.ceil(bottom) - 1;
    const rows = [];
    for (let globalY = rowFirst; globalY <= rowLast; globalY++) {
      const weight = overlapInterval(top, bottom, globalY);
      if (weight === 0) continue;
      rows.push({ index: modulo(globalY, sourceHeight), weight });
    }

    for (let ox = 0; ox < outputWidth; ox++) {
      const left = offsetX + ox * cell;
      const right = left + cell;
      const columnFirst = Math.floor(left);
      const columnLast = Math.ceil(right) - 1;
      const columns = [];
      for (let globalX = columnFirst; globalX <= columnLast; globalX++) {
        const weight = overlapInterval(left, right, globalX);
        if (weight === 0) continue;
        columns.push({ index: modulo(globalX, sourceWidth), weight });
      }

      let alpha = 0;
      let premulR = 0;
      let premulG = 0;
      let premulB = 0;

      for (const row of rows) {
        for (const column of columns) {
          const sourceOffset = (row.index * sourceWidth + column.index) * 4;
          const sourceAlpha = source[sourceOffset + 3] / 255;
          const area = column.weight * row.weight;
          const areaWeight = area / footprintArea;
          alpha += areaWeight * sourceAlpha;
          // Premultiplied channel in 0..255 units. Transparent RGB cannot
          // dilute a colored edge to black because its premultiplied value is 0.
          premulR += areaWeight * source[sourceOffset] * sourceAlpha;
          premulG += areaWeight * source[sourceOffset + 1] * sourceAlpha;
          premulB += areaWeight * source[sourceOffset + 2] * sourceAlpha;
        }
      }

      const destination = (oy * outputWidth + ox) * 4;
      const alpha8 = Math.round(alpha * 255);
      output[destination + 3] = alpha8;
      if (alpha8 === 0) {
        output[destination] = 0;
        output[destination + 1] = 0;
        output[destination + 2] = 0;
      } else {
        // Quantize the straight color nearest its area-averaged value. The
        // reconstructed premultiplied value remains within one output unit.
        output[destination] = Math.max(0, Math.min(255, Math.round(premulR / alpha)));
        output[destination + 1] = Math.max(0, Math.min(255, Math.round(premulG / alpha)));
        output[destination + 2] = Math.max(0, Math.min(255, Math.round(premulB / alpha)));
      }
    }
  }

  return { width: outputWidth, height: outputHeight, data: output };
}

// Descriptive aliases used by different workbench/test entry points.
export const areaResample = resampleTile;
export const areaTileProof = resampleTile;
export const createTileProof = resampleTile;
export const generateTileProof = resampleTile;
export const makeTiledProof = resampleTile;
export const renderTiledProof = resampleTile;
export const renderTileProof = resampleTile;
export const samplePeriodicPattern = resampleTile;
export const scalePeriodicTile = resampleTile;
export const tileProof = resampleTile;

export function premultipliedDifference(actual, expected) {
  const differences = [];
  for (let i = 0; i < actual.length; i += 4) {
    const aa = actual[i + 3] / 255;
    const ea = expected[i + 3] / 255;
    differences.push(
      Math.abs(actual[i + 3] - expected[i + 3]),
      Math.abs((actual[i] * aa) - (expected[i] * ea)),
      Math.abs((actual[i + 1] * aa) - (expected[i + 1] * ea)),
      Math.abs((actual[i + 2] * aa) - (expected[i + 2] * ea)),
    );
  }
  return Math.max(...differences);
}
