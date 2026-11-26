import { $, el } from './dom.mjs';
import { readMarkFile, readBackdropPng, compositeLocally, encodePngBytes } from './mark-local.mjs';

const markInput = $('mark-file');
const backdropInput = $('backdrop-file');
const markSource = $('mark-source');
const status = $('composite-status');
const result = $('composite-result');
const download = $('composite-download');

let frozenMark = null;      // bytes of the currently open frozen version
let customMark = null;      // user-selected mark, overrides the frozen one
let backdrop = null;
let objectUrl = null;

function report(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function activeMarkBytes() {
  return customMark ?? frozenMark;
}

function resetResult() {
  result.replaceChildren();
  download.hidden = true;
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
}

async function runComposite() {
  resetResult();
  const bytes = activeMarkBytes();
  if (!bytes) return report('没有可用的徽记素材：先冻结版本或选择 .inkmark 文件', true);
  if (!backdrop) return report('等待底图');
  try {
    const mark = await readMarkFile(new File([bytes], 'mark.inkmark', { type: 'application/x-ink-mark' }));
    let pixels;
    try {
      pixels = compositeLocally(mark, backdrop);
    } catch (error) {
      return report(error.message, true);
    }
    const canvas = encodePngBytes(mark.width, mark.height, pixels);
    canvas.classList.add('raster');
    result.replaceChildren(canvas);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    objectUrl = URL.createObjectURL(blob);
    download.href = objectUrl;
    download.hidden = false;
    report(`已合成 ${mark.width}×${mark.height}，全程本地完成`);
  } catch (error) {
    report(error.message, true);
  }
}

export function setFrozenMark(markBytes, id) {
  frozenMark = markBytes;
  customMark = null;
  markInput.value = '';
  markSource.textContent = id ? `使用当前冻结稿素材 ${id.slice(0, 12)}` : '使用当前冻结稿素材';
  resetResult();
  report('等待底图');
}

export function clearFrozenMark() {
  frozenMark = null;
  customMark = null;
  markInput.value = '';
  markSource.textContent = '无冻结素材，请选择 .inkmark 文件';
  resetResult();
  report('等待底图');
}

markInput.addEventListener('change', () => {
  const file = markInput.files[0];
  markInput.value = '';
  if (!file) return;
  file.arrayBuffer().then(buffer => {
    customMark = new Uint8Array(buffer);
    markSource.textContent = `使用自选素材 ${file.name}`;
    resetResult();
    runComposite();
  }).catch(error => report(error.message, true));
});

backdropInput.addEventListener('change', () => {
  const file = backdropInput.files[0];
  backdropInput.value = '';
  if (!file) return;
  readBackdropPng(file).then(loaded => {
    backdrop = loaded;
    runComposite();
  }).catch(error => report(error.message, true));
});

report('等待底图');
