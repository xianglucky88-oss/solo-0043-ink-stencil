import { $, el } from './dom.mjs';
import { get, post } from './api.mjs';

const panel = $('kits-panel');
let current = null;

function numberField(label, value, { min, max, step = 1 }) {
  const row = el('div', undefined, 'field');
  const input = el('input');
  input.type = 'number';
  input.value = value;
  input.min = min; input.max = max; input.step = step;
  row.append(el('label', label), input);
  return { row, input };
}

function note(text, error = false) {
  const output = el('p', text, 'note');
  if (error) output.style.color = '#ff9d94';
  return output;
}

// 选中冻结版本后调用：只认冻结件，不读取当前草稿。
export function selectVersion(version) {
  current = version;
  renderForm();
}

function renderForm(message) {
  panel.replaceChildren();
  if (!current) {
    panel.append(note('先在「冻结版本」中选择一份已冻结校样'));
    return;
  }
  const meta = el('p', `版本 ${current.slice(0, 12)}`, 'mono note');
  const trimX = numberField('成品框 X', 0, { min: -4096, max: 4096 });
  const trimY = numberField('成品框 Y', 0, { min: -4096, max: 4096 });
  const trimW = numberField('成品框宽', 100, { min: 1, max: 1024 });
  const trimH = numberField('成品框高', 100, { min: 1, max: 1024 });
  const bleed = numberField('四边出血', 0, { min: 0, max: 512 });
  const scaleRow = el('div', undefined, 'field');
  const scale = el('select');
  for (const value of [1, 2]) {
    const option = el('option', `${value} 倍原生像素`);
    option.value = value;
    scale.append(option);
  }
  scaleRow.append(el('label', '输出倍率'), scale);
  const submit = el('button', '从冻结版本出分幅套件', 'accent');
  submit.type = 'button';
  const status = el('div');
  if (message) status.append(note(message.text, message.error));

  submit.onclick = async () => {
    submit.disabled = true;
    status.replaceChildren(note('正在栅格化并发布套件…'));
    try {
      const body = {
        version: current,
        trim: {
          x: trimX.input.valueAsNumber, y: trimY.input.valueAsNumber,
          w: trimW.input.valueAsNumber, h: trimH.input.valueAsNumber,
        },
        bleed: bleed.input.valueAsNumber,
        scale: Number(scale.value),
      };
      const kit = await post('/api/kits', body);
      renderSummary(kit);
    } catch (error) {
      status.replaceChildren(note(error.message, true));
    } finally {
      submit.disabled = false;
    }
  };

  panel.append(meta, trimX.row, trimY.row, trimW.row, trimH.row, bleed.row, scaleRow, submit, status);
}

async function renderSummary(kit) {
  panel.replaceChildren();
  panel.append(
    el('p', `套件 ${kit.id.slice(0, 12)}`, 'mono note'),
    el('p', `整幅输出 ${kit.size.width} × ${kit.size.height} · ${kit.tiles.length} 片 · 每片 ≤512 px`, 'note'),
    el('p', `成品框位置 (${kit.frame.x}, ${kit.frame.y}) 尺寸 ${kit.frame.w} × ${kit.frame.h}`, 'note'),
  );
  const list = el('ol', undefined, 'kit-list');
  for (const tile of kit.tiles) {
    const row = el('li');
    row.append(
      el('span', `#${String(tile.index).padStart(2, '0')} @(${tile.x}, ${tile.y}) ${tile.width}×${tile.height}`, 'mono'),
      Object.assign(el('a', tile.file), { href: tile.url, download: tile.file }),
    );
    list.append(row);
  }
  panel.append(list);
  const again = el('button', '按另一规格再出一套');
  again.type = 'button';
  again.onclick = () => renderForm();
  panel.append(again);
  // 预热链接校验，确认凭链接可直接取回。
  const check = await get(kit.manifestUrl);
  if (check.id !== kit.id) renderForm({ text: '套件链接校验失败', error: true });
}
