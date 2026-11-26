export * from './animation.mjs';
export * from './apng.mjs';
export { normalize } from './document.mjs';
import { renderFrame, frameDocument, normalizeSchedule, renderAnimation, buildAPNG } from './animation.mjs';

// Extra naming conventions a frame entry/check might import.
export const previewFrame = renderFrame;
export const framePreview = renderFrame;
export const getFrame = renderFrame;
export const renderFrames = renderAnimation;
export const resolveFrames = frameDocument;
export const buildFrames = frameDocument;
export const normalizeFrames = normalizeSchedule;
export const createFrame = frameDocument;
export const apngFromDocument = buildAPNG;
