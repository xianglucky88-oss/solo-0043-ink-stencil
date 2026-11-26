import { el } from './dom.mjs';

// Per-layer workbench controls. Every commit mutates a parsed draft and the
// app re-renders the panel from the canonical document.
export function mountLayerEditor(container, doc, commit) {
  container.replaceChildren();
  if (!doc || !Array.isArray(doc.layers)) {
    container.append(el('p', '载入工作文档后可编辑图层。', 'note'));
    return;
  }

  const cards = doc.layers.map((layer, index) => ({ layer, index })).reverse();
  for (const { layer, index } of cards) {
    const card = el('fieldset', undefined, 'layer-card');
    card.dataset.layerId = layer.id;

    // ---- identity / visibility / order ----
    const head = el('div', undefined, 'layer-card-head');
    const idInput = globalThis.document.createElement('input');
    idInput.value = layer.id; idInput.setAttribute('aria-label', '图层标识'); idInput.className = 'layer-id mono';
    idInput.spellcheck = false;
    idInput.addEventListener('change', () => commit(draft => rename(draft, index, idInput.value.trim())));

    const visLabel = el('label', undefined, 'check');
    const vis = globalThis.document.createElement('input');
    vis.type = 'checkbox'; vis.checked = layer.visible === true; vis.setAttribute('aria-label', '图层可见');
    vis.addEventListener('change', () => commit(draft => { draft.layers[index].visible = vis.checked; }));
    visLabel.append(vis, globalThis.document.createTextNode('可见'));

    const up = el('button', '↑', 'order'); up.type = 'button'; up.title = '向画面前方（图层面板上方）移动'; up.setAttribute('aria-label', '图层前移');
    up.disabled = index === doc.layers.length - 1;
    up.addEventListener('click', () => commit(draft => swap(draft, index, +1)));
    const down = el('button', '↓', 'order'); down.type = 'button'; down.title = '向画面后方（图层面板下方）移动'; down.setAttribute('aria-label', '图层后移');
    down.disabled = index === 0;
    down.addEventListener('click', () => commit(draft => swap(draft, index, -1)));

    const order = el('span', undefined, 'order-buttons'); order.append(up, down);
    head.append(idInput, visLabel, order);
    card.append(head);

    // ---- parameter grid ----
    const grid = el('div', undefined, 'layer-grid');
    grid.append(
      colorField(layer, commit, index),
      numberField('不透明度', layer.opacity, [0, 1, 0.05], value => commit(draft => { draft.layers[index].opacity = value; })),
      selectField('混合', layer.blend, [['normal', '正常'], ['multiply', '乘色'], ['screen', '滤色']],
        value => commit(draft => { draft.layers[index].blend = value; })),
      maskField(doc, layer, index, commit),
      numberField('旋转°', layer.transform?.rotation ?? 0, [-360, 360, 1],
        value => commit(draft => { draft.layers[index].transform.rotation = value; })),
      numberField('缩放 X', layer.transform?.sx ?? 1, [0.1, 5, 0.05],
        value => commit(draft => { draft.layers[index].transform.sx = value; })),
      numberField('缩放 Y', layer.transform?.sy ?? 1, [0.1, 5, 0.05],
        value => commit(draft => { draft.layers[index].transform.sy = value; })),
    );
    card.append(grid);

    const shape = layer.shape;
    if (shape?.kind === 'contours' && Array.isArray(shape.pieces)) {
      const holes = shape.pieces.reduce((sum, piece) => sum + (piece.holes?.length ?? 0), 0);
      const meta = el('p', `${shape.pieces.length} 个可分别编辑的分块 · ${holes} 个透明孔；分块边界点可在「源文档」中修改。`, 'piece-meta');
      meta.dataset.pieces = String(shape.pieces.length);
      card.append(meta);
    }
    container.append(card);
  }
}

function labelWrap(text, control) {
  const label = el('label', undefined, 'mini-field');
  if (text) label.append(el('span', text));
  label.append(control);
  return label;
}

function numberField(text, value, [min, max, step], onCommit) {
  const input = globalThis.document.createElement('input');
  input.type = 'number'; input.value = value; input.min = min; input.max = max; input.step = step;
  input.setAttribute('aria-label', text);
  input.addEventListener('change', () => {
    const next = input.valueAsNumber;
    if (!Number.isFinite(next) || next < min || next > max) { input.value = value; return; }
    onCommit(next);
  });
  return labelWrap(text, input);
}

function selectField(text, value, options, onCommit) {
  const select = globalThis.document.createElement('select');
  select.setAttribute('aria-label', text);
  for (const [id, label] of options) {
    const option = el('option', label); option.value = id;
    if (id === value) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => onCommit(select.value));
  return labelWrap(text, select);
}

function colorField(layer, commit, index) {
  const wrap = el('label', undefined, 'mini-field color-field');
  wrap.append(el('span', '颜色'));
  const row = el('span', undefined, 'color-row');
  const picker = globalThis.document.createElement('input');
  picker.type = 'color'; picker.setAttribute('aria-label', '图层颜色选择器');
  picker.value = /^#[0-9a-f]{6}$/i.test(layer.color) ? layer.color : layer.color.slice(0, 7);
  const hex = globalThis.document.createElement('input');
  hex.type = 'text'; hex.value = layer.color; hex.className = 'mono hex'; hex.spellcheck = false;
  hex.setAttribute('aria-label', '图层颜色十六进制');
  picker.addEventListener('input', () => { hex.value = picker.value; });
  picker.addEventListener('change', () => commit(draft => { draft.layers[index].color = picker.value; }));
  hex.addEventListener('change', () => {
    const value = hex.value.trim();
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) { hex.value = layer.color; return; }
    commit(draft => { draft.layers[index].color = value.toLowerCase(); });
  });
  row.append(picker, hex); wrap.append(row);
  return wrap;
}

function maskField(doc, layer, index, commit) {
  const select = globalThis.document.createElement('select');
  select.setAttribute('aria-label', '遮罩图层');
  const none = el('option', '无遮罩'); none.value = ''; select.append(none);
  doc.layers.slice(0, index).forEach(prior => {
    const option = el('option', `${prior.id}（前序层）`); option.value = prior.id;
    if (layer.mask === prior.id) option.selected = true;
    select.append(option);
  });
  if (layer.mask && !doc.layers.slice(0, index).some(p => p.id === layer.mask)) {
    const bad = el('option', `${layer.mask}（无效引用）`); bad.value = layer.mask; bad.selected = true; select.append(bad);
  }
  select.addEventListener('change', () => commit(draft => { draft.layers[index].mask = select.value || null; }));
  return labelWrap('遮罩', select);
}

function rename(draft, index, newId) {
  const oldId = draft.layers[index].id;
  if (newId === oldId) return;
  if (!/^[a-zA-Z0-9][\w-]{0,31}$/.test(newId)) throw new Error('图层标识需为 1–32 位英数、下划线或连字符');
  if (draft.layers.some(l => l.id === newId)) throw new Error('图层标识不得重复');
  draft.layers[index].id = newId;
  for (const layer of draft.layers) if (layer.mask === oldId) layer.mask = newId;
}

function swap(draft, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= draft.layers.length) return;
  [draft.layers[index], draft.layers[target]] = [draft.layers[target], draft.layers[index]];
  // Mask references may only point at earlier (bottom) layers; prune broken ones.
  const seen = new Set();
  for (const layer of draft.layers) {
    if (layer.mask && !seen.has(layer.mask)) layer.mask = null;
    seen.add(layer.id);
  }
}
