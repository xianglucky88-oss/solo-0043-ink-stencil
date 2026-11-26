import { el } from './dom.mjs';
import { mergeDocuments } from '../product/merge.mjs';

export function mountImport(container, getTarget, onApply, onError, afterApply) {
  if (!container) return;
  container.replaceChildren();
  container.closest?.('details')?.setAttribute('open', '');

  const state = { source: null, selected: new Set(), busy: false };
  const note = el('p', '', 'note merge-note');
  note.setAttribute('role', 'status');

  const heading = el('h4', '从另一份墨版源稿合入徽记');
  const help = el('p', '指定两份稿的画布内对位矩形：源框四边分别对到目标框四边。框只用于对位，不会成为新的裁切框。', 'note');
  const file = el('input');
  file.type = 'file';
  file.id = 'merge-source-file';
  file.accept = '.json,application/json';
  file.setAttribute('aria-label', '选择另一份墨版源稿 JSON');

  const sourceText = el('textarea');
  sourceText.id = 'merge-source-document';
  sourceText.rows = 8;
  sourceText.placeholder = '粘贴另一份墨版源稿 JSON，或选择文件';
  sourceText.setAttribute('aria-label', '另一份墨版源稿 JSON');

  const refresh = el('button', '读取源稿图层');
  refresh.type = 'button';
  const picker = el('fieldset', undefined, 'merge-picker');
  const legend = el('legend', '选择要带入的图层');
  const checkList = el('div', undefined, 'merge-checks');
  picker.append(legend, checkList);

  const idsInput = el('input');
  idsInput.type = 'text';
  idsInput.id = 'merge-ids';
  idsInput.placeholder = '也可填逗号分隔的图层 ID';
  idsInput.setAttribute('aria-label', '要合入的图层 ID');

  const sourceRect = rectFields('source-rect', '源框');
  const targetRect = rectFields('target-rect', '目标框');
  const rects = el('div', undefined, 'merge-rects');
  rects.append(sourceRect.fieldset, targetRect.fieldset);

  const fullSource = el('button', '源稿整幅');
  fullSource.type = 'button';
  fullSource.className = 'ghost';
  const fullTarget = el('button', '目标稿整幅');
  fullTarget.type = 'button';
  fullTarget.className = 'ghost';
  const rectActions = el('div', undefined, 'merge-rect-actions');
  rectActions.append(fullSource, fullTarget);

  const button = el('button', '合入所选图层', 'accent');
  button.type = 'button';
  button.id = 'merge-layers-button';
  const actions = el('div', undefined, 'merge-actions');
  actions.append(button);

  container.append(heading, help, file, sourceText, refresh, picker, idsInput, rects, rectActions, actions, note);

  file.addEventListener('change', async () => {
    const selectedFile = file.files?.[0];
    file.value = '';
    if (!selectedFile) return;
    try {
      if (selectedFile.size > 6 * 1024 * 1024) throw new Error('源稿超过 6 MiB');
      sourceText.value = await selectedFile.text();
      loadSource();
      setNote(`已读取 ${selectedFile.name}`);
    } catch (error) {
      report(error);
    }
  });

  refresh.addEventListener('click', () => {
    try { loadSource(); setNote('源稿图层已读取'); }
    catch (error) { report(error); }
  });

  fullSource.addEventListener('click', () => {
    try {
      const source = loadSource();
      setRect(sourceRect.inputs, { x: 0, y: 0, w: source.width, h: source.height });
    } catch (error) { report(error); }
  });

  fullTarget.addEventListener('click', () => {
    try {
      const target = getTarget?.();
      if (!target) throw new Error('当前目标稿尚未载入');
      setRect(targetRect.inputs, { x: 0, y: 0, w: target.width, h: target.height });
    } catch (error) { report(error); }
  });

  button.addEventListener('click', async () => {
    if (state.busy) return;
    try {
      state.busy = true;
      button.disabled = true;
      const source = loadSource();
      const target = getTarget?.();
      if (!target) throw new Error('当前目标稿尚未载入');
      const ids = [
        ...state.selected,
        ...idsInput.value.split(',').map(id => id.trim()).filter(Boolean),
      ];
      const payload = {
        target,
        source,
        ids: [...new Set(ids)],
        sourceRect: readRect(sourceRect.inputs, '源框'),
        targetRect: readRect(targetRect.inputs, '目标框'),
      };
      const merged = mergeDocuments(payload);
      onApply?.(merged);
      setNote(`已合入 ${merged.addedIds.length} 层（含自动带入的裁边依赖）`);
      if (afterApply) await afterApply(merged);
    } catch (error) {
      report(error);
    } finally {
      state.busy = false;
      button.disabled = false;
    }
  });

  // Initialize the target frame from the current proof when possible.
  const fillTargetIfEmpty = target => {
    if (!target?.width || !target?.height) return;
    if (Object.values(targetRect.inputs).some(input => input.value !== '')) return;
    setRect(targetRect.inputs, { x: 0, y: 0, w: target.width, h: target.height });
  };
  try {
    fillTargetIfEmpty(getTarget?.());
  } catch { /* The user can fill the frame manually. */ }
  window.addEventListener?.('ink:document-changed', event => fillTargetIfEmpty(event.detail?.document));

  function loadSource() {
    let source;
    try {
      source = JSON.parse(sourceText.value);
    } catch {
      throw new Error('源稿不是有效的 JSON');
    }
    if (!source || typeof source !== 'object' || !Array.isArray(source.layers)) {
      throw new Error('源稿必须包含 layers 数组');
    }
    state.source = source;
    renderChecks(source);
    if (Number.isFinite(source.width) && Number.isFinite(source.height) &&
        Object.values(sourceRect.inputs).every(input => input.value === '')) {
      setRect(sourceRect.inputs, { x: 0, y: 0, w: source.width, h: source.height });
    }
    return source;
  }

  function renderChecks(source) {
    checkList.replaceChildren();
    const valid = new Set(source.layers.map(layer => layer.id));
    for (const id of state.selected) if (!valid.has(id)) state.selected.delete(id);
    if (!source.layers.length) checkList.append(el('p', '源稿没有图层', 'muted'));
    for (const layer of source.layers) {
      const label = el('label', undefined, 'merge-layer-option');
      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.value = layer.id;
      checkbox.checked = state.selected.has(layer.id);
      checkbox.dataset.layerId = layer.id;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.selected.add(layer.id);
        else state.selected.delete(layer.id);
      });
      const text = el('span');
      text.append(el('strong', layer.id));
      text.append(el('small', `${layer.shape?.kind ?? 'shape'}${layer.mask ? ` · 依赖裁边 ${layer.mask}` : ''}`));
      label.append(checkbox, text);
      checkList.append(label);
    }
  }

  function setNote(message, error = false) {
    note.textContent = message;
    note.dataset.error = String(error);
  }

  function report(error) {
    const message = error?.message ?? String(error);
    setNote(message, true);
    onError?.(message, error);
  }
}

function rectFields(idPrefix, title) {
  const fieldset = el('fieldset', undefined, 'rect-fields');
  fieldset.append(el('legend', title));
  const inputs = {};
  for (const key of ['x', 'y', 'w', 'h']) {
    const label = el('label', key.toUpperCase());
    const input = el('input');
    input.type = 'number';
    input.step = 'any';
    input.id = `${idPrefix}-${key}`;
    input.name = `${idPrefix}-${key}`;
    input.setAttribute('aria-label', `${title} ${key.toUpperCase()}`);
    inputs[key] = input;
    label.append(input);
    fieldset.append(label);
  }
  return { fieldset, inputs };
}

function readRect(inputs, label) {
  const rect = {};
  for (const key of ['x', 'y', 'w', 'h']) {
    const value = inputs[key].valueAsNumber;
    if (!Number.isFinite(value)) throw new Error(`${label}缺少 ${key.toUpperCase()} 数值`);
    rect[key] = value;
  }
  return rect;
}

function setRect(inputs, rect) {
  for (const key of ['x', 'y', 'w', 'h']) inputs[key].value = rect[key];
}
