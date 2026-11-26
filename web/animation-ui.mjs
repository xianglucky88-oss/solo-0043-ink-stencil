import { el } from './dom.mjs';

const TIME_KEYS = ['at', 'start', 'time', 'startTime', 'startAt', 'offset', 'begin', 'from', 'when', 't'];

// Best-effort client-side read; the server remains the strict authority.
export function scheduleOf(document) {
  if (!document || typeof document !== 'object') return null;
  for (const key of ['animation', 'timeline', 'schedule', 'motion', 'reveal', 'sequence']) {
    const value = document[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.frames)) return value;
    if (Array.isArray(value)) return { frames: value };
  }
  if (Array.isArray(document.frames)) return { frames: document.frames, end: document.end ?? document.duration };
  return null;
}

export function frameCount(document) {
  return scheduleOf(document)?.frames?.length ?? 0;
}

function frameTime(frame, index) {
  if (frame && typeof frame === 'object') {
    for (const key of TIME_KEYS) {
      const value = frame[key];
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export function mountAnimationBar({ document, activeFrame, apngUrl, onFrame, onExport }) {
  const schedule = scheduleOf(document);
  const count = schedule?.frames?.length ?? 0;
  if (!count) return null;

  const bar = el('section', undefined, 'anim-bar');
  bar.id = 'animation-panel';
  bar.setAttribute('aria-label', '帧安排与 APNG 导出');

  const head = el('div', undefined, 'anim-head');
  head.append(el('strong', '循环揭幕 · 帧安排'));
  const end = schedule.end ?? schedule.duration;
  if (Number.isFinite(end)) head.append(el('span', `循环终点 ${end} ms`, 'muted mono'));
  bar.append(head);

  const strip = el('div', undefined, 'frame-strip');
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', '选择要单独校样的帧');
  schedule.frames.forEach((frame, index) => {
    const time = frameTime(frame, index);
    const button = el('button', undefined, 'frame-chip');
    button.type = 'button';
    button.id = `frame-button-${index}`;
    button.dataset.frame = String(index);
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(index === activeFrame));
    if (index === activeFrame) button.classList.add('is-active');
    const title = el('span', `第 ${index + 1} 帧`, 'frame-chip-name');
    const stamp = el('small', Number.isFinite(time) ? `${time} ms` : `帧 ${index + 1}`, 'mono');
    button.append(title, stamp);
    button.title = `直接预览第 ${index + 1} 帧，无需先看其它帧`;
    button.addEventListener('click', () => onFrame?.(index));
    strip.append(button);
  });
  bar.append(strip);

  const actions = el('div', undefined, 'anim-actions');
  const exportButton = el('button', '导出透明 APNG', 'accent');
  exportButton.type = 'button';
  exportButton.id = 'export-apng';
  exportButton.title = '用同一份帧安排导出可直接循环播放的透明 APNG，无需冻结';
  exportButton.addEventListener('click', () => onExport?.());
  const hint = el('span', '按文件时序循环 · 不改变普通校样与 PNG 下载', 'muted anim-hint');
  actions.append(exportButton, hint);
  bar.append(actions);

  if (apngUrl) {
    const previewRow = el('div', undefined, 'apng-preview-row');
    const image = el('img');
    image.id = 'apng-preview';
    image.alt = '透明 APNG 循环预览';
    image.src = apngUrl;
    const note = el('span', '导出件实时循环预览（透明底）', 'muted');
    previewRow.append(image, note);
    bar.append(previewRow);
  }
  return bar;
}
