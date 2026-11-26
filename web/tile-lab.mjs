import { $ } from './dom.mjs';
import { resampleTile } from './tile-resample.mjs';

export function mountTileLab() {
  const file = $('tile-source');
  const canvas = $('tile-proof-canvas');
  const status = $('tile-lab-status');
  const download = $('tile-proof-download');
  const apply = $('tile-apply');
  if (!file || !canvas || !apply) return;

  let source = null;
  let objectUrl = null;
  let outputTouched = false;

  function note(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }

  function settings() {
    return {
      outputWidth: $('tile-out-width').valueAsNumber,
      outputHeight: $('tile-out-height').valueAsNumber,
      offsetX: $('tile-offset-x').valueAsNumber,
      offsetY: $('tile-offset-y').valueAsNumber,
      cell: $('tile-cell').valueAsNumber,
    };
  }

  function render() {
    if (!source) {
      note('请先选择实际交付的铺贴 PNG。', true);
      return;
    }
    try {
      const result = resampleTile(source, settings());
      canvas.width = result.width;
      canvas.height = result.height;
      canvas.getContext('2d', { willReadFrequently: true }).putImageData(
        new ImageData(result.data, result.width, result.height), 0, 0,
      );
      try {
        download.href = canvas.toDataURL('image/png');
        download.hidden = false;
      } catch {
        // The canvas itself remains inspectable if serialization is unavailable.
      }
      note(`已离线生成 ${result.width} × ${result.height} 铺贴校样。`);
    } catch (error) {
      note(error.message, true);
    }
  }

  async function open(selected) {
    if (!selected) return;
    try {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(selected);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      const off = document.createElement('canvas');
      off.width = image.naturalWidth;
      off.height = image.naturalHeight;
      const context = off.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      source = {
        width: off.width,
        height: off.height,
        data: context.getImageData(0, 0, off.width, off.height).data,
      };
      if (!outputTouched) {
        const cell = $('tile-cell').valueAsNumber || 1;
        $('tile-out-width').value = Math.max(1, Math.round(off.width / cell));
        $('tile-out-height').value = Math.max(1, Math.round(off.height / cell));
      }
      note(`已读取本地文件 ${selected.name}（${off.width} × ${off.height}），未使用原稿或服务。`);
      render();
    } catch (error) {
      source = null;
      note(`无法读取 PNG：${error.message}`, true);
    }
  }

  file.addEventListener('change', () => open(file.files[0]));
  apply.addEventListener('click', render);
  for (const id of ['tile-out-width', 'tile-out-height', 'tile-offset-x', 'tile-offset-y', 'tile-cell']) {
    $(id).addEventListener('input', () => {
      if (id === 'tile-out-width' || id === 'tile-out-height') outputTouched = true;
      if (source) render();
    });
    $(id).addEventListener('change', render);
  }
  window.tileLab = { resampleTile, render, get source() { return source; } };
  window.tileProof = { resampleTile, render };
  window.resampleTile = resampleTile;
  window.renderTiledProof = resampleTile;
}
