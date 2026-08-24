import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const launcherDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(launcherDir, 'electron-builder.json'), 'utf8'));

test('o pacote inclui a UI CEF como recurso do launcher', () => {
  assert.ok(config.extraResources.some((entry) => entry.from === '../../skymp/ui' && entry.to === 'skymp-ui'));
});

test('o pacote não inclui recursivamente a própria pasta de saída', () => {
  assert.ok(config.files.includes('dist-electron/main.mjs'));
  assert.ok(config.files.includes('dist-electron/preload.mjs'));
  assert.ok(!config.files.includes('dist-electron/**/*'));
});
