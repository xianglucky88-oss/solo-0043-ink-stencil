import { el } from './dom.mjs';

export function layerEditor(layers, onChange) {
  const box = el('div', undefined, 'layer-editor');
  if (typeof onChange !== 'function') return box;
  for (const layer of [...layers].reverse()) {
    const row = el('div', undefined, 'layer-edit-row');
    row.dataset.layerId = layer.id;

    const heading = el('div', undefined, 'layer-edit-head');
    heading.append(el('strong', layer.id));
    const opacityNumber = el('input');
    opacityNumber.type = 'number';
    opacityNumber.min = '0';
    opacityNumber.max = '1';
    opacityNumber.step = '0.01';
    opacityNumber.value = String(layer.opacity ?? 1);
    opacityNumber.className = 'layer-opacity-number mono';
    opacityNumber.setAttribute('aria-label', `${layer.id} 不透明度`);
    opacityNumber.dataset.layerOpacity = '';
    heading.append(opacityNumber);

    const controls = el('div', undefined, 'layer-edit-controls');
    const color = el('input');
    color.type = 'color';
    color.value = hexColor(layer.color).slice(0, 7);
    color.setAttribute('aria-label', `${layer.id} 颜色`);
    color.dataset.layerColor = '';

    const opacity = el('input');
    opacity.type = 'range';
    opacity.min = '0';
    opacity.max = '1';
    opacity.step = '0.01';
    opacity.value = String(layer.opacity ?? 1);
    opacity.setAttribute('aria-label', `${layer.id} 不透明度滑块`);
    opacity.dataset.layerOpacityRange = '';

    const commitColor = () => {
      const oldAlpha = /^#[0-9a-fA-F]{8}$/.test(layer.color) ? layer.color.slice(7) : '';
      onChange(layer.id, { color: color.value + oldAlpha });
    };
    color.addEventListener('input', commitColor);
    color.addEventListener('change', commitColor);
    const commitOpacity = value => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      const next = Math.min(1, Math.max(0, parsed));
      opacity.value = String(next);
      opacityNumber.value = String(next);
      onChange(layer.id, { opacity: next });
    };
    opacity.addEventListener('input', () => {
      opacityNumber.value = opacity.value;
      commitOpacity(opacity.value);
    });
    opacity.addEventListener('change', () => commitOpacity(opacity.value));
    opacityNumber.addEventListener('change', () => {
      opacity.value = opacityNumber.value;
      commitOpacity(opacityNumber.value);
    });

    controls.append(color, opacity);
    row.append(heading, controls);
    box.append(row);
  }
  return box;
}

function hexColor(color) {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(color) ? color : '#000000';
}
