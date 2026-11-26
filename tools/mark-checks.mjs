import assert from 'node:assert/strict';
import { normalize } from '../product/document.mjs';
import { readMark, directProof } from '../product/mark-export.mjs';
import { compositeMark, MARK_TYPE } from '../product/mark.mjs';
import { png, decodePng } from '../product/png.mjs';

// Builds an 8-bit straight-RGBA backdrop and round-trips it through the PNG
// encoder/decoder, mirroring the 8-bit RGBA pixels the web entry receives.
function backdropPng(width, height, paint) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    paint(pixels, p, x, y);
  }
  return decodePng(png(width, height, pixels));
}

const cases = {
  // Fully transparent backdrop, but carrying nonzero RGB on alpha-0 pixels.
  transparent: (pixels) => {
    for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 201; pixels[i + 1] = 17; pixels[i + 2] = 99; pixels[i + 3] = 0; }
  },
  // Opaque backdrop alternating dark and light neighbors.
  checker: (pixels, p, x, y) => {
    const dark = ((x >> 2) + (y >> 2)) % 2 === 0;
    pixels[p] = dark ? 16 : 238; pixels[p + 1] = dark ? 28 : 214; pixels[p + 2] = dark ? 44 : 182; pixels[p + 3] = 255;
  },
  // Neighboring pixels with different coverage, including zero, and RGB on
  // the transparent ones.
  varyingAlpha: (pixels, p, x, y) => {
    pixels[p] = (x * 37) % 256; pixels[p + 1] = (y * 53) % 256; pixels[p + 2] = (x * y + 17) % 256;
    pixels[p + 3] = ((x * 7 + y * 13) % 5 === 0) ? 0 : ((x + y) % 2 ? 1 : 254);
  },
};

export function markChecks({ document, save, get }) {
  // The plate checks run several seconds of purely local compute. A reused
  // keep-alive socket can be closed by the server during that idle gap, so
  // retry once on a reset connection (the next attempt opens a fresh socket).
  const freshGet = async (path) => {
    try {
      return await get(path);
    } catch (error) {
      if (error?.cause?.code !== 'ECONNRESET') throw error;
      return get(path);
    }
  };
  return {
    mark: async () => {
      // The server freezes the normalized canonical document; the proof and
      // plates below must be compared against that same normalized geometry.
      document = normalize(document);
      const { id } = await save();
      const response = await freshGet(`/api/library/${id}/mark`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), MARK_TYPE);
      assert.match(response.headers.get('content-disposition') ?? '', /\.inkmark"$/);
      const bytes = Buffer.from(await response.arrayBuffer());

      // The container is raster-only: decoding exposes dimensions and three
      // numeric plates, never vector sources, shapes or transforms.
      const mark = await readMark(bytes);
      assert.deepEqual(Object.keys(mark).sort(), ['height', 'plates', 'width']);
      assert.equal(mark.width, document.width);
      assert.equal(mark.height, document.height);
      assert.equal(mark.plates.length, 3);
      for (const plate of mark.plates) {
        assert.ok(plate instanceof Uint16Array);
        assert.equal(plate.length, document.width * document.height * 4);
        for (const value of plate) assert.ok(Number.isInteger(value) && value >= 0 && value <= 65535);
      }
      for (const layer of document.layers) assert.ok(!bytes.includes(Buffer.from(layer.id)), '素材不得泄漏图层标识');

      const { width, height } = document;
      const unit = 1 / 255;
      for (const [name, paint] of Object.entries(cases)) {
        const backdrop = backdropPng(width, height, paint);
        const local = compositeMark(mark, backdrop);
        const proof = directProof(document, backdrop);
        let straight = 0, premultiplied = 0;
        for (let i = 0; i < local.length; i += 4) {
          // Alpha always compares; RGB only where something is visible, since
          // zero-alpha output is required to encode zero RGB.
          straight = Math.max(straight, Math.abs(local[i + 3] - proof[i + 3]));
          if (local[i + 3] === 0) {
            assert.deepEqual([local[i], local[i + 1], local[i + 2]], [0, 0, 0], `${name}: 零透明度 RGB 须为零`);
            assert.equal(proof[i + 3], 0, `${name}: 直接校样透明度应一致`);
            continue;
          }
          for (let c = 0; c < 3; c++) straight = Math.max(straight, Math.abs(local[i + c] - proof[i + c]));
          const aLocal = local[i + 3] / 255, aProof = proof[i + 3] / 255;
          for (let c = 0; c < 3; c++) {
            premultiplied = Math.max(premultiplied, Math.abs((local[i + c] / 255) * aLocal - (proof[i + c] / 255) * aProof));
          }
        }
        assert.ok(straight <= 1, `${name}: 直通通道差 ${straight} 超过一个量化单位`);
        assert.ok(premultiplied <= unit + 1e-12, `${name}: 预乘通道差 ${premultiplied} 超过一个量化单位`);

        // Untouched pixels keep the backdrop's 8-bit values.
        for (let i = 0; i < local.length; i += 4) {
          if (mark.plates[0][i + 3] === 0) {
            for (let c = 0; c < 4; c++) {
              if (local[i + 3] === 0 && c < 3) continue; // zero-alpha RGB is forced to zero by rule
              assert.equal(local[i + c], backdrop.pixels[i + c], `${name}: 未画到像素须保留底图值`);
            }
          }
        }
      }

      // A mismatched backdrop must produce no image.
      assert.throws(() => compositeMark(mark, backdropPng(width - 1, height, () => {})), /不一致/);
      assert.throws(() => compositeMark(mark, { width, height: height + 1, pixels: Buffer.alloc(0) }), /不一致/);

      // Legacy proof PNG download is unchanged and still served.
      const asset = await freshGet(`/api/library/${id}/asset`);
      assert.equal(asset.status, 200);
      assert.equal(asset.headers.get('content-type'), 'image/png');
    },
  };
}
