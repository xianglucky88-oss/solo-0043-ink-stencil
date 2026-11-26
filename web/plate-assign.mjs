import { el } from './dom.mjs';

const PLATE_OPTIONS = [['', '不下墨'], ['a', 'A 墨版'], ['b', 'B 墨版']];
const MODE_OPTIONS = [['knockout', '挖空'], ['overprint', '叠印']];

// Per-layer ink assignment. The screen color and blend mode stay untouched:
// only `plate` ('a' | 'b' | null) and `overprint` (boolean) drive the plates.
export function mountPlateAssignment(container, document, change) {
  if (!container) return;
  container.replaceChildren();
  const rows = document.layers.map((layer, index) => {
    const row = el('div', undefined, 'plate-row');
    const label = el('div', undefined, 'plate-layer-label');
    label.append(el('strong', layer.id));
    label.append(el('small', `${layer.visible ? '可见' : '隐藏 · 仅裁形'} · ${layer.blend}`));

    const plateSelect = el('select');
    plateSelect.setAttribute('aria-label', `${layer.id} 归属墨版`);
    for (const [value, text] of PLATE_OPTIONS) {
      const option = el('option', text);
      option.value = value;
      const current = layer.plate == null || layer.plate === -1 ? '' : (layer.plate === 0 ? 'a' : layer.plate === 1 ? 'b' : layer.plate);
      if (String(current) === value) option.selected = true;
      plateSelect.append(option);
    }

    const modeSelect = el('select');
    modeSelect.setAttribute('aria-label', `${layer.id} 叠印或挖空`);
    for (const [value, text] of MODE_OPTIONS) {
      const option = el('option', text);
      option.value = value;
      const mode = layer.overprint === true ? 'overprint' : 'knockout';
      if (mode === value) option.selected = true;
      modeSelect.append(option);
    }
    modeSelect.disabled = plateSelect.value === '';

    plateSelect.addEventListener('change', () => {
      const next = structuredClone(document);
      const value = plateSelect.value;
      next.layers[index].plate = value === '' ? null : value;
      if (value !== '' && typeof next.layers[index].overprint !== 'boolean') {
        next.layers[index].overprint = modeSelect.value === 'overprint';
      }
      change(next);
    });
    modeSelect.addEventListener('change', () => {
      const next = structuredClone(document);
      next.layers[index].overprint = modeSelect.value === 'overprint';
      if (next.layers[index].plate == null) next.layers[index].plate = plateSelect.value || null;
      change(next);
    });

    const controls = el('div', undefined, 'plate-row-controls');
    controls.append(plateSelect, modeSelect);
    row.append(label, controls);
    return row;
  });
  container.append(...rows);
}

// Render the two delivered grayscale plate files with download links.
export function showPlateFiles(container, payload, decode) {
  if (!container || !payload?.plateFiles) return;
  container._revoke?.();
  container.replaceChildren();
  const urls = [];
  const grid = el('div', undefined, 'plate-thumbs');
  for (const file of payload.plateFiles) {
    const blob = decode(file.base64, file.mediaType ?? 'image/png');
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const figure = el('figure', undefined, 'plate-thumb');
    const image = el('img');
    image.src = url;
    image.alt = `${file.id.toUpperCase()} 墨版灰度 PNG（0 无墨，255 满墨）`;
    image.width = file.width; image.height = file.height;
    const caption = el('figcaption');
    const link = el('a', `${file.id.toUpperCase()} 版 · ${file.width}×${file.height} · 下载`);
    link.href = url;
    link.download = file.filename ?? `plate-${file.id}.png`;
    caption.append(link);
    figure.append(image, caption);
    grid.append(figure);
  }
  const hint = el('p', '灰度值即墨量：0 无墨（黑），255 满墨（白）；下载件为非隔行八位灰度 PNG。', 'muted plate-hint');
  container.append(grid, hint);
  container._revoke = () => urls.forEach((url) => URL.revokeObjectURL(url));
}
