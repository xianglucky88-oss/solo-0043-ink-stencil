#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { decodePNG } from '../product/png-decode.mjs';
import { png } from '../product/png.mjs';
import { resampleTile, resolveCellSize } from '../product/area-proof.mjs';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function positional() {
  return process.argv.slice(2).filter((arg, index, args) => {
    if (arg.startsWith('--')) return false;
    const previous = args[index - 1];
    return !(previous && previous.startsWith('--'));
  });
}

const [positionalInput] = positional();
const input = option('--input', option('--source', option('--file', positionalInput)));
if (!input) {
  console.error('用法: node tools/tile-proof.mjs <tile.png> [--input tile.png] [--width N] [--height N] [--x F] [--y F] [--cell 1..32] [--out proof.png]');
  process.exit(2);
}

const file = resolve(input);
const source = decodePNG(await readFile(file));
const options = {
  outputWidth: Number(option('--width', option('--output-width', '160'))),
  outputHeight: Number(option('--height', option('--output-height', '120'))),
  offsetX: Number(option('--x', option('--offset-x', '0'))),
  offsetY: Number(option('--y', option('--offset-y', '0'))),
};
const cellArgument = option('--cell');
const scaleArgument = option('--scale');
if (cellArgument !== undefined) options.cell = Number(cellArgument);
else if (scaleArgument !== undefined) options.scale = Number(scaleArgument);
const result = resampleTile(source, options);
const output = option('--out', option('--output', resolve(dirname(file), 'tile-proof.png')));
await writeFile(output, png(result.width, result.height, Buffer.from(result.data)));
console.log(`Tile proof: ${output} (${result.width}x${result.height}, cell=${resolveCellSize(options)})`);
