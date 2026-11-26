import { el } from './dom.mjs';

const DEFAULTS = { a: '#009fe3', b: '#e5007d' };

function round255(value) {
  if (!(value > 0)) return 0;
  if (value >= 1) return 255;
  return Math.floor(255 * value + 0.5 + 1e-9);
}

function hexColor(hex) {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex?.trim?.() ?? '');
  if (!value) return [0, 0, 0];
  const int = parseInt(value[1], 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

// Strict spec check from IHDR bytes, then decode pixels through the canvas.
export async function readPlateFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 29 || !signature.every((b, i) => bytes[i] === b)) {
    throw new Error('规格不符：不是有效的 PNG 文件');
  }
  const view = new DataView(buffer);
  const width = view.getUint32(16), height = view.getUint32(20);
  const bitDepth = bytes[24], colorType = bytes[25], interlace = bytes[28];
  if (bitDepth !== 8 || colorType !== 0 || interlace !== 0) {
    throw new Error('规格不符：须为不带透明度的非隔行八位灰度 PNG');
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none' });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) gray[i] = data[i * 4];
  bitmap.close?.();
  return { width, height, gray, name: file.name };
}

function sample(plate, x, y) {
  if (!plate || x < 0 || y < 0 || x >= plate.width || y >= plate.height) return 0;
  return plate.gray[y * plate.width + x] / 255;
}

export function mountPlateBench(root) {
  if (!root) return null;
  root.replaceChildren();
  const state = {
    plates: { a: null, b: null },
    shifts: { a: { dx: 0, dy: 0 }, b: { dx: 0, dy: 0 } },
    colors: { ...DEFAULTS },
    target: 'a',
    downloadUrl: null,
  };

  const intro = el('p', '不打开源稿：直接选择手头两张版文件，在白纸模拟色上做套印校样。版外视为无墨。', 'muted');

  // ---- file pickers ----------------------------------------------------
  const fileRow = (which) => {
    const label = el('label', undefined, 'file-button');
    label.append(`${which.toUpperCase()} 版 PNG `);
    const input = el('input');
    input.type = 'file'; input.accept = '.png,image/png'; input.hidden = true;
    const meta = el('span', '未选择', 'mono muted bench-file-meta');
    label.append(input);
    input.addEventListener('change', () => loadInput(which, input, meta));
    const wrap = el('div', undefined, 'bench-file-row');
    wrap.append(label, meta);
    return wrap;
  };

  // ---- ink colors ------------------------------------------------------
  const colorRow = el('div', undefined, 'bench-colors');
  const colorInputs = {};
  for (const which of ['a', 'b']) {
    const label = el('label', `${which.toUpperCase()} 满印色`);
    const picker = el('input');
    picker.type = 'color'; picker.value = DEFAULTS[which];
    picker.setAttribute('aria-label', `${which.toUpperCase()} 墨八位 sRGB 满印模拟色`);
    colorInputs[which] = picker;
    picker.addEventListener('input', () => { state.colors[which] = picker.value; renderProof(); });
    label.append(picker);
    colorRow.append(label);
  }

  // ---- shift controls --------------------------------------------------
  const shiftRow = el('div', undefined, 'bench-shift');
  const targetSelect = el('select');
  targetSelect.setAttribute('aria-label', '选择要挪位的版');
  for (const [value, text] of [['a', '移动 A 版'], ['b', '移动 B 版']]) {
    const option = el('option', text); option.value = value; targetSelect.append(option);
  }
  const dxInput = numberInput('横移 X', -512, 512);
  const dyInput = numberInput('竖移 Y', -512, 512);
  targetSelect.addEventListener('change', () => { state.target = targetSelect.value; syncShiftInputs(); });
  dxInput.addEventListener('change', () => { state.shifts[state.target].dx = Math.trunc(dxInput.valueAsNumber || 0); renderProof(); });
  dyInput.addEventListener('change', () => { state.shifts[state.target].dy = Math.trunc(dyInput.valueAsNumber || 0); renderProof(); });
  const nudge = (text, dx, dy, label) => {
    const button = el('button', text);
    button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
    button.addEventListener('click', () => {
      const shift = state.shifts[state.target];
      shift.dx += dx; shift.dy += dy;
      syncShiftInputs(); renderProof();
    });
    return button;
  };
  const pad = el('div', undefined, 'nudge-pad');
  pad.append(
    nudge('←', -1, 0, '向左横移一像素'),
    nudge('→', 1, 0, '向右横移一像素'),
    nudge('↑', 0, -1, '向上竖移一像素'),
    nudge('↓', 0, 1, '向下竖移一像素'),
  );
  shiftRow.append(targetSelect, dxInput, dyInput, pad);

  const useCurrent = el('button', '载入当前工作稿两张墨版');
  useCurrent.type = 'button';
  useCurrent.addEventListener('click', () => root.dispatchEvent(new CustomEvent('bench-use-current', { bubbles: true })));

  const status = el('output', '等待两张版文件', 'mono muted');
  status.id = 'bench-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');

  const canvasWrap = el('div', undefined, 'bench-canvas-wrap');
  const canvas = el('canvas', undefined, 'bench-canvas');
  canvas.hidden = true;
  canvasWrap.hidden = true;
  canvasWrap.append(canvas);
  const download = el('a', '下载校样 PNG');
  download.hidden = true; download.className = 'file-button'; download.download = 'plate-overprint-proof.png';

  root.append(intro, fileRow('a'), fileRow('b'), useCurrent, colorRow, shiftRow, status, canvasWrap, download);

  function numberInput(ariaLabel, min, max) {
    const input = el('input');
    input.type = 'number'; input.min = min; input.max = max; input.step = 1; input.value = '0';
    input.setAttribute('aria-label', ariaLabel);
    return input;
  }
  function syncShiftInputs() {
    const shift = state.shifts[state.target];
    dxInput.value = String(shift.dx); dyInput.value = String(shift.dy);
  }

  async function loadInput(which, input, meta) {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const plate = await readPlateFile(file);
      state.plates[which] = plate;
      meta.textContent = `${plate.name} · ${plate.width}×${plate.height}`;
      meta.classList.remove('bench-error');
      renderProof();
    } catch (error) {
      state.plates[which] = null;
      meta.textContent = error.message;
      meta.classList.add('bench-error');
      canvas.hidden = true; canvasWrap.hidden = true; download.hidden = true;
      status.textContent = error.message;
      status.classList.add('bench-error');
    }
  }

  async function loadBase64(which, base64, filename) {
    // Decode without fetch(): the page CSP allows data: images but not data:
    // connects. Construct the same File the picker would hand us.
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], filename ?? `plate-${which}.png`, { type: 'image/png' });
    const plate = await readPlateFile(file);
    state.plates[which] = plate;
    const meta = root.querySelectorAll('.bench-file-meta')[which === 'a' ? 0 : 1];
    if (meta) { meta.textContent = `${file.name} · ${plate.width}×${plate.height}`; meta.classList.remove('bench-error'); }
    renderProof();
  }

  function renderProof() {
    status.classList.remove('bench-error');
    const { a, b } = state.plates;
    if (!a || !b) { status.textContent = '等待两张版文件'; canvas.hidden = true; canvasWrap.hidden = true; download.hidden = true; return; }
    if (a.width !== b.width || a.height !== b.height) {
      canvas.hidden = true; canvasWrap.hidden = true; download.hidden = true;
      status.textContent = `两版尺寸不一致（A ${a.width}×${a.height}，B ${b.width}×${b.height}），规格不符不出校样`;
      status.classList.add('bench-error');
      return;
    }
    const width = a.width, height = a.height;
    const ca = hexColor(state.colors.a), cb = hexColor(state.colors.b);
    const image = new ImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const ta = sample(a, x - state.shifts.a.dx, y - state.shifts.a.dy);
        const tb = sample(b, x - state.shifts.b.dx, y - state.shifts.b.dy);
        const offset = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const singleA = 1 + (ca[c] - 1) * ta;
          const singleB = 1 + (cb[c] - 1) * tb;
          image.data[offset + c] = round255(singleA * singleB);
        }
        image.data[offset + 3] = 255;
      }
    }
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').putImageData(image, 0, 0);
    canvas.hidden = false;
    canvasWrap.hidden = false;
    status.textContent = `${width}×${height} · A 挪位 ${state.shifts.a.dx},${state.shifts.a.dy} · B 挪位 ${state.shifts.b.dx},${state.shifts.b.dy}`;
    if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
    canvas.toBlob((blob) => {
      if (!blob) return;
      state.downloadUrl = URL.createObjectURL(blob);
      download.href = state.downloadUrl;
      download.hidden = false;
    }, 'image/png');
  }

  return {
    loadCurrent(payload) {
      if (!payload?.plateFiles) return;
      const [a, b] = payload.plateFiles;
      return Promise.all([
        loadBase64('a', a.base64, a.filename),
        loadBase64('b', b.base64, b.filename),
      ]).catch((error) => { status.textContent = error.message; status.classList.add('bench-error'); });
    },
  };
}
