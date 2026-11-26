// Proof-focused entry point alias; all proof/plate helpers live in plates.mjs.
export {
  compositeProof, overprintProof, proofPlates, buildProof, proofFromBody,
  normalizeShift, normalizeInkColor, inkByte, roundInk,
  rasterPlates, renderPlates,
} from './plates.mjs';
export { readPlatePng, decodePlate, decodePng, grayPng } from './png.mjs';
